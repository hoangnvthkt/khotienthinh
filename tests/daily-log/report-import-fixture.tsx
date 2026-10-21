// Nhật ký · Dán báo cáo Zalo → phiếu nháp (PR-2). Cây hạng mục thật DA29 + kết quả AI thật (claude-sonnet-5-5, tin dán 3 ngày 13–15/10).
// Không gọi Supabase. ?memory=1: đã nhớ "ubot sàn mái tầng 2" = 3.3.6 · ?ai=fail: AI lỗi
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { DailyLogReportImport, type ReportImportHooks } from '../../components/project/daily-log/DailyLogReportImport';
import type { MemoryAlias, ReportRead } from '../../lib/dailyLogReport';
import type { ProjectTask } from '../../types';
import DATA from './report-fixture-data.json';

const params = new URLSearchParams(location.search);
const tasks = DATA.tasks as unknown as ProjectTask[];
const idOf = (code: string) => tasks.find(t => t.wbsCode === code)!.id;
const UBOT = 'SXLD ván khuôn cốt thép sàn mái, lắp đặt ubot sàn mái tầng 2 nhà nghỉ ca';
const memory: MemoryAlias[] = params.get('memory') ? [
  { kind: 'task', alias: UBOT, aliasNorm: 'sxld van khuon cot thep san mai lap dat ubot san mai tang 2 nha nghi ca', targetId: idOf('3.3.6'), targetLabel: '3.3.6 Lắp đặt hộp nhựa sàn tầng 2', hits: 2 },
  { kind: 'crew', alias: 'công nhật', aliasNorm: 'cong nhat', targetId: null, targetLabel: 'Tổ công nhật Đỗ Hiệp Đoàn', hits: 3 },
] : [];
const w = window as unknown as Record<string, unknown>;
const hooks: ReportImportHooks = {
  read: async input => {
    w.__aiInput = { reportDate: input.reportDate, taskLines: input.tasks.split('\n').length, hints: input.hints, crews: input.crews };
    await new Promise(r => setTimeout(r, 1200));
    if (params.get('ai') === 'fail') return { code: 'AI_FAILED', error: 'AI_HTTP_502' };
    return { code: 'OK', runId: 'run-report', result: DATA.read as unknown as ReportRead, model: 'claude-sonnet-5-5', provider: 'openai_compatible', usage: { tokensIn: 14198, tokensOut: 3110, costUsd: null, durationMs: 29630 } };
  },
  feedback: () => undefined,
  memory: async () => memory,
  learn: async (_p, _s, pairs) => { w.__learned = pairs; },
  recentAreas: async () => [{ code: 'NX1', name: 'Nhà xưởng' }, { code: 'NHA-NGHI-CA', name: 'Nhà Nghỉ ca' }, { code: 'NVP', name: 'Nhà văn phòng' }],
  knownCrews: async () => ['Tổ Đỗ Duy Ích', 'Tổ Phan Hữu Trịnh', 'Tổ công nhật Đỗ Hiệp Đoàn'],
  createDraft: async ({ slip }) => {
    await new Promise(r => setTimeout(r, 150));
    w.__created = [...((w.__created as unknown[]) || []), { date: slip.date, area: slip.areaCode, works: slip.works.length, crews: slip.crews.map(c => `${c.label}:${c.people}`) }];
    if (slip.date === '2026-10-13' && slip.areaCode === 'NX1') return { slip, status: 'exists', contributionId: 'existing-nx1-1310', message: 'Đã có phiếu của mũi này trong ngày — mở để bổ sung.' };
    return { slip, status: 'created', contributionId: `c-${slip.date}-${slip.areaCode}` };
  },
};

const Fixture: React.FC = () => {
  const [open, setOpen] = useState(true);
  const [opened, setOpened] = useState('');
  return <div className="min-h-screen bg-background p-4 text-foreground">
    <h1 className="text-lg font-black">Nhật ký công trường · DA29</h1>
    {opened && <p role="status">{opened}</p>}
    {!open && <button type="button" onClick={() => setOpen(true)}>Dán báo cáo Zalo</button>}
    {open && <DailyLogReportImport projectId="da29" constructionSiteId="site-da29" tasks={tasks} defaultDate="2026-10-17" hooks={hooks}
      onClose={() => setOpen(false)} onCreated={() => undefined} onOpenSlip={(date, id) => { setOpen(false); setOpened(`Mở phiếu ${date} ${id}`); }} />}
  </div>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
