import React from 'react';
import { Settings2 } from 'lucide-react';
import { WmsOwnersView } from '../components/wms/WmsOwnersView';

// Kho vật tư → Người phụ trách (V1-2): thủ kho theo kho, cấp mã, duyệt ngoại lệ, kế toán kho.
const WmsOwners: React.FC = () => (
  <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    <header className="flex min-w-0 items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Settings2 size={22} /></span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Người phụ trách kho</h1>
        <p className="text-sm text-muted-foreground">Ai giữ kho nào, ai cấp mã, duyệt ngoại lệ, làm kế toán kho. Chỉ Admin sửa.</p>
      </div>
    </header>
    <WmsOwnersView />
  </main>
);

export default WmsOwners;
