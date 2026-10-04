import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { areaCodeFromName, copyFromArea, defaultEntryMode, defaultForecast, forecastProblem } from '../dailyLogSlipRules';
import { lateDays, needsNewForecast, resourceTotals, type DailyLogTodayBoard } from '../dailyLogTodayBoard';
import type { DailyLogRecentArea } from '../dailyLogWbsService';
import { DailyLogContributionWorkEditor } from '../../components/project/daily-log/DailyLogContributionWorkEditor';
import { engineerBundle } from './dailyLogEngineerSlip.test';

describe('Nhật ký v3 — quy tắc phiếu kỹ sư', () => {
  it('nhập KL hôm nay khi có cơ sở quy đổi và số hôm trước, còn lại nhập %', () => {
    expect(defaultEntryMode({ unit: 'm³', plannedQuantity: 100, baselineQuantityState: 'known' })).toBe('daily_quantity');
    expect(defaultEntryMode({ unit: 'm³', plannedQuantity: 100, baselineQuantityState: 'none' })).toBe('daily_quantity');
    expect(defaultEntryMode({ unit: 'm³', plannedQuantity: 100, baselineQuantityState: 'unknown' })).toBe('percent');
    expect(defaultEntryMode({ unit: null, plannedQuantity: 100, baselineQuantityState: 'known' })).toBe('percent');
  });

  it('không lấy ngày kế hoạch đã qua làm ngày dự kiến xong', () => {
    expect(defaultForecast('2026-10-10', '2026-10-04')).toBe('2026-10-10');
    expect(defaultForecast('2026-08-14', '2026-10-04')).toBeNull();
  });

  it('hạng mục quá kế hoạch chưa xong phải có ngày dự kiến mới và lý do', () => {
    const base = { scheduleFinishDate: '2026-08-14', slipDate: '2026-10-04', cumulativePercent: 20 };
    expect(forecastProblem({ ...base, forecastFinishDate: null })).toBe('new_date_required');
    expect(forecastProblem({ ...base, forecastFinishDate: '2026-08-14' })).toBe('new_date_required');
    expect(forecastProblem({ ...base, forecastFinishDate: '2026-10-03', forecastChangeReason: 'x' })).toBe('new_date_required');
    expect(forecastProblem({ ...base, forecastFinishDate: '2026-11-15' })).toBe('reason_required');
    expect(forecastProblem({ ...base, forecastFinishDate: '2026-11-15', forecastChangeReason: 'Thiếu thép' })).toBeNull();
    expect(forecastProblem({ ...base, cumulativePercent: 100, forecastFinishDate: '2026-08-14' })).toBeNull();
    expect(forecastProblem({ scheduleFinishDate: '2026-10-10', forecastFinishDate: '2026-10-10', slipDate: '2026-10-04' })).toBeNull();
  });

  it('mã mũi lấy theo tên, ổn định qua các ngày', () => {
    expect(areaCodeFromName('Nhà xưởng 1')).toBe('NHA-XUONG-1');
    expect(areaCodeFromName('  Hạng mục phụ trợ ')).toBe('HANG-MUC-PHU-TRO');
    expect(areaCodeFromName('Đường nội bộ')).toBe('DUONG-NOI-BO');
  });

  it('chép phiếu trước: hạng mục chưa xong còn trong phạm vi, tổ đội và máy theo dòng, ngày dự kiến còn hiệu lực', () => {
    const area: DailyLogRecentArea = { code: 'NX1', name: 'Nhà xưởng 1', lastDate: '2026-10-01', items: [
      { taskId: 't1', forecastFinishDate: '2026-11-05', forecastChangeReason: 'Chờ vật tư', cumulativePercent: 20 },
      { taskId: 't2', forecastFinishDate: '2026-08-01', cumulativePercent: 40 },
      { taskId: 't3', cumulativePercent: 100 },
      { taskId: 'gone', cumulativePercent: 10 }],
      labor: [{ taskId: 't1', laborType: 'Thợ nề', peopleCount: 7, hoursPerPerson: 8, provider: { entryMode: 'catalog', partnerId: 'p1', providerNameSnapshot: 'Tổ Tuấn', manualProviderType: null } as any }],
      machines: [{ taskId: 't2', machineType: 'Máy xúc', machineCount: 1, hoursPerMachine: 5, provider: { entryMode: 'manual', manualProviderType: 'machine_owner', manualProviderName: 'Tiến Thịnh', partnerId: null } as any }] };
    let n = 0;
    const out = copyFromArea({ area, slipDate: '2026-10-04', taskIds: new Set(['t1', 't2', 't3']), newKey: () => `k${++n}` });
    expect(out.items).toEqual([
      { taskId: 't1', workBoqItemId: null, clientKey: 'k1', forecastFinishDate: '2026-11-05', forecastChangeReason: 'Chờ vật tư' },
      { taskId: 't2', workBoqItemId: null, clientKey: 'k2', forecastFinishDate: null, forecastChangeReason: null }]);
    expect(out.labor).toEqual([{ workItemClientKey: 'k1', laborType: 'Thợ nề', peopleCount: 7, hoursPerPerson: 8, contractItemId: null,
      provider: { entryMode: 'catalog', partnerId: 'p1', providerCodeSnapshot: null, providerNameSnapshot: 'Tổ Tuấn' } }]);
    expect(out.machines[0]).toMatchObject({ workItemClientKey: 'k2', machineType: 'Máy xúc', provider: { entryMode: 'manual', manualProviderName: 'Tiến Thịnh' } });
    expect(out.machines[0].provider).not.toHaveProperty('partnerId');
  });
});

describe('Nhật ký v3 — Báo cáo ngày', () => {
  it('đếm ngày trễ theo ngày dự kiến mới, hoặc đến ngày báo cáo khi chưa có', () => {
    expect(lateDays({ scheduleFinishDate: '2026-08-14', forecastFinishDate: '2026-11-15', cumulativePercent: 20 }, '2026-10-01')).toBe(93);
    expect(lateDays({ scheduleFinishDate: '2026-07-11', forecastFinishDate: '2026-07-11', cumulativePercent: 50 }, '2026-10-01')).toBe(82);
    expect(lateDays({ scheduleFinishDate: '2026-07-11', cumulativePercent: 100 }, '2026-10-01')).toBeNull();
    expect(needsNewForecast({ scheduleFinishDate: '2026-07-11', forecastFinishDate: '2026-07-11', cumulativePercent: 50 }, '2026-10-01')).toBe(true);
    expect(needsNewForecast({ scheduleFinishDate: '2026-07-11', forecastFinishDate: '2026-10-20', cumulativePercent: 50 }, '2026-10-01')).toBe(false);
  });

  it('cộng "ai làm" theo tổ đội và máy trên phiếu đã gửi', () => {
    const item = (taskName: string, labor: any[], machines: any[] = []) => ({ taskName, labor, machines });
    const board = { date: '2026-10-01', missingFronts: [], summary: null, yesterday: null, days: [], slips: [
      { id: 'a', status: 'submitted', photos: [], photoCount: 0, people: 0, laborHours: 0, machineCount: 0, machineHours: 0, items: [
        item('Xây tường', [{ provider: 'Tổ Tuấn', people: 7, hours: 56, contractLinked: true }], [{ machineType: 'Máy trộn', provider: 'Tiến Thịnh', count: 1, hours: 8 }]),
        item('Lu nền', [{ provider: 'Tổ anh Mạnh', people: 4, hours: 32, manual: true }, { provider: 'Tổ Tuấn', people: 2, hours: 16 }])] },
      { id: 'b', status: 'draft', photos: [], photoCount: 0, people: 0, laborHours: 0, machineCount: 0, machineHours: 0, items: [item('Nháp', [{ provider: 'Tổ Tuấn', people: 99, hours: 1 }])] },
    ] } as unknown as DailyLogTodayBoard;
    const totals = resourceTotals(board);
    expect(totals.crews.map(crew => [crew.name, crew.people, crew.hours, crew.items.length])).toEqual([['Tổ Tuấn', 9, 72, 2], ['Tổ anh Mạnh', 4, 32, 1]]);
    expect(totals.crews[1]).toMatchObject({ manual: true, contractLinked: false });
    expect(totals.machines).toMatchObject([{ name: 'Máy trộn', provider: 'Tiến Thịnh', count: 1, hours: 8 }]);
  });

  it('hàm đọc giữ quyền Room view, nháp riêng tác giả, không trả giá tiền', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261008171000_daily_log_v3_report.sql'), 'utf8');
    expect(sql.match(/'daily_log', 'view'\)\) then/g)).toHaveLength(2);
    expect(sql.match(/message = 'DAILY_LOG_VIEW_REQUIRED'/g)).toHaveLength(2);
    expect(sql).toContain("(c.status <> 'draft' or c.author_user_id = v_actor)");
    expect(sql).toContain('revoke all on function public.get_daily_log_recent_areas_v1(text, text, date) from public, anon;');
    expect(sql).not.toMatch(/unit_price|unit_cost|total_cost|total_price/);
  });
});

describe('Nhật ký v3 — phiếu kỹ sư nhập tại dòng', () => {
  const overdue = { ...engineerBundle, tasks: [{ ...engineerBundle.tasks[0], endDate: '2026-09-20' }],
    contribution: { ...engineerBundle.contribution!, sourceDraftPayload: { ...engineerBundle.contribution!.sourceDraftPayload!,
      items: [{ ...engineerBundle.contribution!.sourceDraftPayload!.items[0], forecastFinishDate: '2026-09-20' }] } } };

  it('chặn gửi khi hạng mục quá kế hoạch chưa có ngày dự kiến mới', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={overdue} />);
    expect(html).toContain('Đã quá kế hoạch: ghi ngày dự kiến xong mới.');
    expect(html).toContain('1 hạng mục đã quá ngày kế hoạch');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Gửi tổng hợp/);
  });

  it('nhắc (không chặn) khi chưa ghi nhân công, và có ô gõ tìm + nút ⊕/⊖ trên dòng', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={engineerBundle} />);
    expect(html).toContain('Chưa ghi nhân công cho hạng mục nào');
    expect(html).toContain('placeholder="Gõ mã hoặc tên hạng mục để thêm…"');
    expect(html).toContain('placeholder="Thêm tổ đội — gõ tên"');
    expect(html).toContain('aria-label="Thêm hạng mục ngay dưới Bê tông móng"');
    expect(html).toContain('aria-label="Bỏ Bê tông móng"');
  });

  it('mời chép phiếu gần nhất của cùng mũi khi phiếu còn trống', () => {
    const empty = { ...engineerBundle, contribution: { ...engineerBundle.contribution!, sourceDraftPayload: { ...engineerBundle.contribution!.sourceDraftPayload!, items: [] } } };
    const area: DailyLogRecentArea = { code: 'A', name: 'Khu A', lastDate: '2026-09-26', lastAuthorName: 'Kỹ sư Minh', items: [{ taskId: 'task-1', cumulativePercent: 40 }], labor: [], machines: [] };
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={empty} recentAreas={[area]} />);
    expect(html).toContain('Phiếu gần nhất của');
    expect(html).toContain('Chép từ phiếu 26/09');
  });
});
