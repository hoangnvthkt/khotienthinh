import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { procurementInboxService, type ProcurementOrderStage, type ProcurementSiteScope } from '../../../lib/procurementInboxService';
import { StateBox } from './hubUi';
import { OrdersView } from './OrdersView';
import { OrderDrawer } from './OrderDrawer';
import { ContractsView } from './ContractsView';
import { HotPurchaseView } from '../hotPurchase/HotPurchaseView';

type SiteMode = 'orders' | 'contracts' | 'hot';

const STAGES: Array<[ProcurementOrderStage, string]> = [
  ['ordered', 'Chờ giao'], ['delivering', 'Đang giao'], ['received', 'Đã giao đủ'], ['drafting', 'Đang lập / duyệt'],
];

const todayVn = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * Mua hàng cho người công trường (không có quyền phòng Mua hàng): xem đơn hàng của dự án mình (chỉ xem),
 * gọi hàng theo hợp đồng, mua nóng. Thay cho tab Đơn hàng PO + Mua nóng trong Dự án → Vật tư.
 */
export const SiteProcurementView: React.FC<{
  currentUserId: string; deniedMessage: string;
  initialMode?: string | null; initialProjectId?: string | null; initialOrderId?: string | null;
  initialContractId?: string | null; initialHotPurchaseId?: string | null;
}> = ({ currentUserId, deniedMessage, initialMode = null, initialProjectId = null, initialOrderId = null, initialContractId = null, initialHotPurchaseId = null }) => {
  const { items, warehouses } = useApp();
  const [scope, setScope] = useState<ProcurementSiteScope | null>(null);
  const [scopeError, setScopeError] = useState(false);
  const [mode, setMode] = useState<SiteMode | null>(
    initialContractId || initialMode === 'contracts' ? 'contracts'
      : initialHotPurchaseId || initialMode === 'hot' ? 'hot'
        : initialMode === 'orders' || initialOrderId ? 'orders' : null);
  const [stage, setStage] = useState<ProcurementOrderStage>('ordered');
  const [orderId, setOrderId] = useState<string | null>(initialOrderId);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    procurementInboxService.siteScope()
      .then(s => { if (!cancelled) setScope(s); })
      .catch(() => { if (!cancelled) setScopeError(true); });
    return () => { cancelled = true; };
  }, []);

  const modes = useMemo(() => {
    const list: Array<[SiteMode, string]> = [];
    if (scope?.orderProjects.length) list.push(['orders', 'Đơn hàng']);
    list.push(['contracts', 'Hợp đồng']);
    list.push(['hot', 'Mua nóng']);
    return list;
  }, [scope]);

  // Không có quyền xem đơn của dự án nào, không lập được mua nóng, không đi từ link cụ thể: giữ thông báo như cũ.
  const hasSiteAccess = Boolean(scope && (scope.orderProjects.length > 0 || scope.canCreateHotPurchase));
  const current: SiteMode | null = mode && modes.some(([k]) => k === mode)
    ? mode
    : hasSiteAccess ? modes[0][0] : null;

  if (!scope && !scopeError && mode !== 'hot' && mode !== 'contracts') return <StateBox kind="loading" title="Đang tải Mua hàng…" />;
  if (!current) return <StateBox kind="denied" message={deniedMessage} />;

  return <>
    <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm" role="tablist" aria-label="Mua hàng tại công trường">
      {modes.map(([k, l]) =>
        <button key={k} type="button" role="tab" aria-selected={current === k} onClick={() => setMode(k)}
          className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition ${current === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>)}
    </div>

    {current === 'hot' ? <HotPurchaseView items={items} initialPurchaseId={initialHotPurchaseId} />
      : current === 'contracts' ? <ContractsView projects={[]} warehouses={warehouses} initialContractId={initialContractId} currentUserId={currentUserId} />
        : <>
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Tình trạng đơn">
            {STAGES.map(([k, l]) =>
              <button key={k} type="button" role="tab" aria-selected={stage === k} onClick={() => setStage(k)}
                className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-sm font-semibold transition ${stage === k ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card text-foreground hover:border-teal-300'}`}>{l}</button>)}
          </div>
          <OrdersView stage={stage} projects={scope?.orderProjects || []} reloadKey={reloadKey} onOpen={setOrderId} initialProjectId={initialProjectId} readOnly />
        </>}

    {orderId && <OrderDrawer orderId={orderId} today={todayVn()} currentUserId={currentUserId}
      onClose={() => setOrderId(null)} onChanged={() => setReloadKey(n => n + 1)} onEdit={() => undefined} />}
  </>;
};
