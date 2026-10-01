import React, { useState } from 'react';
import { ClipboardList, History } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useModuleData } from '../hooks/useModuleData';
import { StockCountView } from '../components/wms/StockCountView';

const AuditLegacy = React.lazy(() => import('./AuditLegacy'));

// K5 — Kiểm kê kho có duyệt. Lịch sử kiểm kê kiểu cũ (trước K5) vẫn xem được, không lập mới được.
const Audit: React.FC = () => {
  const { items } = useApp();
  useModuleData('wms');
  const [view, setView] = useState<'count' | 'legacy'>('count');
  return <div className="space-y-4">
    <div className="inline-flex rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Kiểm kê">
      {([['count', 'Kiểm kê', ClipboardList], ['legacy', 'Lịch sử cũ (trước 10/2026)', History]] as const).map(([k, l, Icon]) =>
        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
          <Icon size={15} />{l}</button>)}
    </div>
    {view === 'count' ? <StockCountView items={items} />
      : <React.Suspense fallback={null}><AuditLegacy /></React.Suspense>}
  </div>;
};

export default Audit;
