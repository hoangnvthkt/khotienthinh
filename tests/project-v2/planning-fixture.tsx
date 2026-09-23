import React, { useState } from 'react';
import '../../index.css';
import { createRoot } from 'react-dom/client';
import { ProjectV2Shell } from '../../components/project-v2/ProjectV2Shell';
import { ProjectV2SourcePicker } from '../../components/project-v2/ProjectV2SourcePicker';
import { MonthPlanEditor } from '../../components/project-v2/MonthPlanEditor';
import { ConstructionPlanEditor, type ConstructionEntry } from '../../components/project-v2/ConstructionPlanEditor';
import { ProjectV2PlanWorkflowActions } from '../../components/project-v2/ProjectV2PlanWorkflowActions';
import type { MonthCandidate, ConstructionCandidate } from '../../lib/projectV2/candidateService';
import type { ProjectV2PlanSummary } from '../../lib/projectV2/readService';

const month: MonthCandidate[] = [
  { contractItemId: 'group', code: '01', title: 'Phần móng', unit: 'm3', parentId: null, isGroup: true,
    contractQuantity: '250.000000', previousPlannedQuantity: '50.000000', availableQuantity: '200.000000',
    baselineRevision: '2026-09-21', baselineState: 'verified', workspaceId: 'w', unavailableReason: null },
  { contractItemId: 'i1', code: '01.01', title: 'Đào đất móng', unit: 'm3', parentId: 'group', isGroup: false,
    contractQuantity: '100.000000', previousPlannedQuantity: '20.000000', availableQuantity: '80.000000',
    baselineRevision: '2026-09-21', baselineState: 'verified', workspaceId: 'w', unavailableReason: null },
  { contractItemId: 'i2', code: '01.02', title: 'Bê tông lót móng', unit: 'm3', parentId: 'group', isGroup: false,
    contractQuantity: '150.000000', previousPlannedQuantity: '30.000000', availableQuantity: '120.000000',
    baselineRevision: '2026-09-21', baselineState: 'verified', workspaceId: 'w', unavailableReason: null },
];
const construction: ConstructionCandidate[] = [{ sourcePlanId: 'plan-month', sourceRevision: 2,
  sourcePlanHash: 'hash', sourceLineId: 'line-1', sourceQuantity: '80.000000', availableQuantity: '60.000000',
  sourceUnit: 'm3', workspaceId: 'w', sourceStatus: 'approved', unavailableReason: null,
  code: 'KT-09', title: 'Đào đất móng', workItemId: 'work-1', contractItemId: 'i1' }];
const plan: ProjectV2PlanSummary = { id: 'plan-1', workspaceId: 'w', planType: 'month', code: 'KT-09',
  title: 'Kế hoạch khối lượng tháng 9', status: 'draft', periodStart: '2026-09-01', periodEnd: '2026-09-30',
  ownerUserId: null, followerUserId: null, creatorUserId: 'u', submitterUserId: null,
  approverUserId: null, revision: 1, version: 1, createdAt: '2026-09-23T00:00:00Z',
  updatedAt: '2026-09-23T00:00:00Z' };

function Fixture() {
  const [type, setType] = useState<'month' | 'construction'>('month');
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Record<string, ConstructionEntry>>({});
  return <div className="min-h-screen bg-slate-50"><ProjectV2Shell projectName="Dự án Riverside" projectCode="DA29"
    clientName="Công ty Xin Hai Vina" siteName="Công trường Riverside" planType={type}
    primaryAction={<button className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">Tạo kế hoạch {type === 'month' ? 'tháng' : 'thi công'}</button>}>
    <div className="flex gap-2"><button type="button" onClick={() => { setType('month'); setSelected([]); }} className="rounded-xl border bg-white px-4 py-2">Tháng</button>
      <button type="button" onClick={() => { setType('construction'); setSelected([]); }} className="rounded-xl border bg-white px-4 py-2">Thi công</button></div>
    <section className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Bước 2/2 · Nguồn kế hoạch</p>
        <h2 className="mt-1 text-xl font-bold">Chọn công việc và khối lượng</h2>
        <p className="mt-1 text-sm text-slate-500">Nguồn được duyệt và khối lượng khả dụng từ máy chủ.</p></div>
      <ProjectV2SourcePicker workspaceId="w" type={type} monthCandidates={month}
        constructionCandidates={construction} selectedIds={selected} onChange={setSelected} />
      {type === 'month' && selected.length > 0 && <MonthPlanEditor rows={month.filter(row => selected.includes(row.contractItemId))}
        quantities={quantities} onChange={(id, value) => setQuantities(previous => ({ ...previous, [id]: value }))} />}
      {type === 'construction' && selected.length > 0 && <ConstructionPlanEditor rows={construction.filter(row => selected.includes(row.sourceLineId))}
        entries={entries} onChange={(id, value) => setEntries(previous => ({ ...previous, [id]: value }))}
        crews={[{ id: 'crew-1', name: 'Tổ thi công số 1', workspaceId: 'w' }]}
        periodStart="2026-09-23" periodEnd="2026-09-29" />}
    </section>
    <section className="rounded-2xl border bg-white p-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-teal-700">Thao tác bản nháp</p>
      <ProjectV2PlanWorkflowActions plan={plan} actorId="u"
        capabilities={{ edit: true, submit: true, approve: false, return: false, revise: false, cancel: false }}
        busy={false} onAction={() => {}} /></section>
  </ProjectV2Shell></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
