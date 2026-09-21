import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { DemandPanel } from '../../components/procurement/DemandPanel';
import { WorkbenchShell } from '../../components/procurement/WorkbenchShell';
import { WorkQueue } from '../../components/procurement/WorkQueue';
import { SupplyPlanDialog } from '../../components/procurement/SupplyPlanDialog';
import type { User } from '../../types';
import type { ProcurementDemandDetail, ProcurementWorkbenchRow, ProcurementView } from '../../types/procurementWorkbench';

const rows: ProcurementWorkbenchRow[] = [{
  id: 'work-1', objectType: 'demand_line', objectId: 'line-1', actionKind: 'plan_supply',
  demandId: 'demand-1', demandLineId: 'line-1', title: 'Thép D16', sourceLabel: 'Đề xuất dự án',
  sourceCode: 'MR-2026-0184', projectId: 'project-a', constructionSiteId: 'site-a',
  destinationLabel: 'Kho công trường Riverside', assigneeUserId: null, unit: 'kg',
  balance: { openNeed: '100.000000', availableToPlan: '80.000000', coverageExcess: '0.000000', receivedExcess: '0.000000' },
  allowedActions: ['assign', 'plan_supply'], version: '1', neededDate: '2026-09-24',
  nextActionLabel: 'Lập phương án cung ứng', tags: [{ label: 'Sẵn sàng', tone: 'success' }],
}, {
  id: 'work-2', objectType: 'demand_line', objectId: 'line-2', actionKind: 'reconcile',
  demandId: 'demand-2', demandLineId: 'line-2', title: 'Xi măng PCB40', sourceLabel: 'Đề xuất dự án',
  sourceCode: 'MR-2026-0187', projectId: 'project-a', constructionSiteId: 'site-a',
  destinationLabel: null, assigneeUserId: 'buyer-a', unit: 'bao',
  balance: { openNeed: null, availableToPlan: null, coverageExcess: null, receivedExcess: null },
  allowedActions: ['view'], version: '2', neededDate: null,
  nextActionLabel: 'Xử lý sai lệch dữ liệu', tags: [{ label: 'Cần đối chiếu', tone: 'warning' }],
}];

const detail: ProcurementDemandDetail = {
  id: 'demand-1', version: '1', title: 'Đề xuất vật tư Riverside', sourceCode: 'MR-2026-0184',
  projectId: 'project-a', constructionSiteId: 'site-a', assigneeUserId: null,
  sourceRef: { type: 'material_request', id: 'request-a', engine: 'project_material_request' },
  allowedActions: ['assign', 'plan_supply'], issues: [], asOf: '2026-09-21T04:00:00Z',
  lines: [{
    id: 'line-1', itemId: 'steel-d16', title: 'Thép D16', unit: 'kg', requestedQty: '100.000000',
    balanceInput: { approved: '100.000000', fulfilled: '10.000000', closed: '0.000000', reserved: '10.000000', committed: '0.000000' },
    balance: { openNeed: '90.000000', availableToPlan: '80.000000', coverageExcess: '0.000000', receivedExcess: '0.000000' },
    allocations: [{
      id: 'allocation-a', method: 'po', state: 'committed', needQty: '10.000000',
      documentRefs: [{ type: 'purchase_order', id: 'po-a', engine: 'purchase_order', label: 'PO-2026-0102' }],
    }],
  }],
};

const users = [
  { id: 'buyer-a', name: 'Nguyễn An', email: 'an@example.invalid', isActive: true, accountStatus: 'ACTIVE' },
  { id: 'disabled-a', name: 'Tài khoản đã khóa', email: 'disabled@example.invalid', isActive: true, accountStatus: 'DISABLED' },
] as User[];

const Fixture = () => {
  const [view, setView] = useState<ProcurementView>('work');
  const [selected, setSelected] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const closeDetail = () => {
    setSelected(false);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
  };
  return <WorkbenchShell view={view} onViewChange={setView} onRefresh={() => {}} refreshing={false}>
    <div className={`grid gap-3 ${selected ? 'xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)]' : ''}`}>
      <WorkQueue rows={rows} selectedId={selected ? 'work-1' : undefined} onSelect={() => {
        detailTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setSelected(true);
      }} />
      {selected && <div className="fixed inset-0 z-50 bg-slate-950/45 p-2 sm:p-4 xl:static xl:z-auto xl:bg-transparent xl:p-0">
        <DemandPanel detail={detail} loading={false} error={null} users={users}
          onClose={closeDetail} onOpenDocument={() => {}} onPlanSupply={() => setPlanOpen(true)}
          onAssign={async () => {}} />
      </div>}
    </div>
    <SupplyPlanDialog open={planOpen} demandLabel="MR-2026-0184" onClose={() => setPlanOpen(false)} onContinuePurchase={() => setPlanOpen(false)} />
  </WorkbenchShell>;
};

createRoot(document.getElementById('root')!).render(<Fixture />);
