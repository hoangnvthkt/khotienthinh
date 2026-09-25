import React, { useState } from 'react';
import '../../index.css';
import { createRoot } from 'react-dom/client';
import { ProjectV2Shell } from '../../components/project-v2/ProjectV2Shell';
import { ProjectV2SourcePicker } from '../../components/project-v2/ProjectV2SourcePicker';
import { MonthPlanEditor } from '../../components/project-v2/MonthPlanEditor';
import { ConstructionPlanEditor, type ConstructionEntry } from '../../components/project-v2/ConstructionPlanEditor';
import { MaterialPlanEditor, type MaterialEntry } from '../../components/project-v2/MaterialPlanEditor';
import { groupMaterialCandidates, type MaterialCandidate } from '../../lib/projectV2/materialCandidateService';
import { MemoryRouter } from 'react-router-dom';
import type { MonthCandidate, ConstructionCandidate } from '../../lib/projectV2/candidateService';

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
const material: MaterialCandidate[] = [{ candidateId: 'work-1:g8:cement', workspaceId: 'w',
  itemId: 'cement', itemCode: 'VT-01', itemName: 'Xi măng PCB40', unit: 'kg',
  calculatedQty: '50.000000', alreadyPlannedQty: '10.000000', availableQty: '40.000000',
  diagnostics: [], selectable: true, sourcePlanId: 'construction-1', sourceRevision: 1,
  sourcePlanHash: 'hash-1', sourceLineId: 'work-1', sourceWorkName: 'Bê tông lót móng',
  sourceWorkQuantity: '10.000000', sourceUnit: 'm3', normResourceId: 'g8:cement',
  normRevision: 'rev-1', normFactor: '5.000000', coefficient: '1.000000',
  conversionNumerator: '1.000000', conversionDenominator: '1.000000' }];
function Fixture() {
  const [type, setType] = useState<'month' | 'construction' | 'material'>('month');
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Record<string, ConstructionEntry>>({});
  const [materialKeys, setMaterialKeys] = useState<string[]>([]);
  const [materialEntries, setMaterialEntries] = useState<Record<string, MaterialEntry>>({});
  return <ProjectV2Shell projectName="Dự án mẫu Riverside" projectCode="DEMO"
    clientName="Công ty mẫu" siteName="Công trường mẫu" planType={type}
    primaryAction={<span className="inline-flex min-h-10 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-bold text-white">Bản xem trước · Dữ liệu mẫu</span>}>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Loại kế hoạch">
      {([['month', 'Tháng'], ['construction', 'Thi công'], ['material', 'Vật tư']] as const).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={type === key}
          onClick={() => { setType(key); setSelected([]); }}
          className={`min-h-10 rounded-xl border px-4 text-sm font-semibold transition-colors ${type === key
            ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{label}</button>)}</div>
    <section className="min-w-0 space-y-5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_-16px_rgba(30,41,59,0.35)] dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-indigo-600 dark:text-indigo-300">Bước 2/2 · Nguồn kế hoạch</p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">Chọn công việc và khối lượng</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Xem nguồn, chọn dòng cần lập và kiểm tra số lượng trước khi lưu.</p></div>
        <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{type === 'month' ? 'Kế hoạch tháng' : type === 'construction' ? 'Kế hoạch thi công' : 'Kế hoạch vật tư'}</span>
      </div>
      {type !== 'material' && <ProjectV2SourcePicker workspaceId="w" type={type} monthCandidates={month}
        constructionCandidates={construction} selectedIds={selected} onChange={setSelected} />
      }
      {type === 'month' && selected.length > 0 && <MonthPlanEditor rows={month.filter(row => selected.includes(row.contractItemId))}
        quantities={quantities} onChange={(id, value) => setQuantities(previous => ({ ...previous, [id]: value }))} />}
      {type === 'construction' && selected.length > 0 && <ConstructionPlanEditor rows={construction.filter(row => selected.includes(row.sourceLineId))}
        entries={entries} onChange={(id, value) => setEntries(previous => ({ ...previous, [id]: value }))}
        crews={[{ id: 'crew-1', name: 'Tổ thi công số 1', workspaceId: 'w' }]}
        periodStart="2026-09-23" periodEnd="2026-09-29" />}
      {type === 'material' && <MaterialPlanEditor groups={groupMaterialCandidates(material)} selectedKeys={materialKeys}
        boqState={{ status: 'ready', positions: new Map([['cement', {
          itemId: 'cement', unit: 'kg', state: 'known', boqQuantity: '100.000000',
          receivedQuantity: '50.000000', remainingQuantity: '50.000000',
          pendingQuantity: null, issues: [],
        }]]) }}
        entries={materialEntries} onSelect={(key, checked) => {
          setMaterialKeys(checked ? [key] : []);
          if (checked) setMaterialEntries({ [key]: { quantity: '40', neededDate: '2026-09-25',
            destinationId: 'site-1', note: '', overrideReason: 'Giao đợt đầu' } });
        }} onChange={(key, patch) => setMaterialEntries(previous => ({ ...previous,
          [key]: { ...previous[key], ...patch } }))}
        periodStart="2026-09-23" periodEnd="2026-09-29" siteName="Công trường mẫu" siteId="site-1" />}
    </section>
    <p className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-slate-600 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-slate-300">Đây là dữ liệu minh họa để xem và thử nhập liệu. Các thay đổi trên trang này không được lưu.</p>
  </ProjectV2Shell>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><Fixture /></MemoryRouter>);
