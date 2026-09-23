import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { MemoryRouter } from 'react-router-dom';
import { ProcurementV2InboxContent } from '../../pages/procurement-v2/ProcurementV2Inbox';
import { ProcurementV2DemandDetailView } from '../../pages/procurement-v2/ProcurementV2DemandDetail';
import { ProcurementV2SupplyDialog } from '../../components/procurement-v2/ProcurementV2SupplyDialog';
import { ProcurementV2PurchaseDialog } from '../../components/procurement-v2/ProcurementV2PurchaseDialog';
import type { ProcurementPurchaseCandidate } from '../../lib/procurement/procurementPurchaseOrderService';
import type { ProcurementV2Dossier, ProcurementV2Filter, ProcurementV2Page } from '../../types/procurementV2';

const dossier: ProcurementV2Dossier = {
  id: 'fixture-demand', sourceAdapter: 'material_plan', sourceCode: 'KHV-10-01',
  sourceDocumentId: 'fixture-plan', sourceRef: { adapter: 'material_plan', id: 'fixture-plan' },
  projectId: 'project-riverside', constructionSiteId: 'site-riverside',
  assigneeUserId: null, assigneeName: null, earliestNeededDate: '2026-10-08',
  destinationSummary: 'Kho công trường Riverside', lineCount: 2,
  stage: 'reconcile', nextAction: 'reconcile', issueCount: 1, version: '3',
  asOf: '2026-09-23T00:00:00Z', allowedActions: ['view'],
  issues: [{ id: 'issue-1', code: 'Cần xác nhận phần đã đặt', severity: 'blocking', sourceLineId: null }],
  lines: [
    { id: 'line-1', sourceLineId: 'source-1', itemId: 'item-1', title: 'Xi măng PCB40', unit: 'kg',
      approvedQty: null, reservedQty: null, committedQty: null, fulfilledQty: null,
      closedQty: null, availableToPlanQty: null, neededDate: '2026-10-08',
      destinationId: 'Kho công trường Riverside', balanceKnown: false,
      diagnostics: ['source_revision_unresolved'], documentRefs: [] },
    { id: 'line-2', sourceLineId: 'source-2', itemId: 'item-2', title: 'Cát vàng', unit: 'm3',
      approvedQty: '20.000000', reservedQty: '5.000000', committedQty: '0.000000',
      fulfilledQty: '0.000000', closedQty: '0.000000', availableToPlanQty: '15.000000',
      neededDate: '2026-10-12', destinationId: 'Kho công trường Riverside',
      balanceKnown: true, diagnostics: [], documentRefs: [] },
  ],
};
const request: ProcurementV2Dossier = { ...dossier, id: 'fixture-request',
  sourceAdapter: 'project_material_request', sourceCode: 'MR-10-02',
  sourceRef: { adapter: 'project_material_request', id: 'fixture-mr' },
  sourceDocumentId: 'fixture-mr', lineCount: 1, stage: 'plan_supply',
  nextAction: 'plan_supply', issueCount: 0, issues: [],
  allowedActions: ['view', 'plan_supply'], lines: [{ ...dossier.lines[1], id: 'request-line' }] };
const readyPlan: ProcurementV2Dossier = { ...request, id: 'fixture-ready-plan',
  sourceAdapter: 'material_plan', sourceCode: 'KHV-10-03',
  sourceDocumentId: 'fixture-ready-plan-source',
  sourceRef: { adapter: 'material_plan', id: 'fixture-ready-plan-source' },
  lines: [{ ...dossier.lines[1], id: 'ready-plan-line' }] };
const candidate = { demandLineId: 'ready-plan-line', itemName: 'Cát vàng', sourceCode: 'KHV-10-03',
  availableQty: '15.000000', fulfilledQty: '0.000000', unit: 'm3',
  purchaseUnit: 'm3', conversionNumerator: '1', conversionDenominator: '1',
  canAllocate: true, canViewPrice: true } as ProcurementPurchaseCandidate;
const page: ProcurementV2Page = { items: [dossier, request, readyPlan], nextCursor: null,
  snapshotToken: 'fixture', asOf: '2026-09-23T00:00:00Z', stale: false,
  counters: [{ key: 'dossiers', count: 3, grain: 'document' }] };

function Fixture() {
  const [selected, setSelected] = useState<ProcurementV2Dossier | null>(null);
  const [open, setOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [filter, setFilter] = useState<ProcurementV2Filter>({});
  return <MemoryRouter>{selected ? <><ProcurementV2DemandDetailView dossier={selected}
    projectName="Dự án Riverside" siteName="Công trường Riverside"
    onBack={() => setSelected(null)} onOpenSource={() => {}}
    onOpenDocument={() => {}} onPlanSupply={() => setOpen(true)} />
    <ProcurementV2SupplyDialog open={open} demandLabel={selected.sourceCode}
      canPurchase={selected.allowedActions.includes('plan_supply')}
      onClose={() => setOpen(false)} onPurchase={() => { setOpen(false); setPurchaseOpen(true); }} />
    <ProcurementV2PurchaseDialog open={purchaseOpen} candidates={[candidate]}
      suppliers={[{ id: 'supplier-1', name: 'Nhà cung cấp An', contactPerson: '', phone: '', debt: 0 }]}
      warehouses={[{ id: 'warehouse-1', name: 'Kho Riverside', address: '', type: 'site' }]}
      onClose={() => setPurchaseOpen(false)} onCreate={async () => { setPurchaseOpen(false); }} />
    {selected.sourceAdapter === 'material_plan' && <div className="mx-auto max-w-7xl px-4 pb-6"><button type="button"
      onClick={() => setOpen(true)} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white">Xem phương án</button></div>}
  </> : <ProcurementV2InboxContent page={page} state="ready" filter={filter}
    projects={[{ id: 'project-riverside', name: 'Dự án Riverside' }]}
    onFilterChange={patch => setFilter(previous => ({ ...previous, ...patch }))}
    onOpen={card => setSelected(card.id === dossier.id ? dossier
      : card.id === request.id ? request : readyPlan)}
    onRefresh={() => {}} onMore={() => {}} />}</MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
