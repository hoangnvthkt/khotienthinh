import React from 'react';
import { Settings2 } from 'lucide-react';
import { WmsAccessView } from '../components/wms/WmsAccessView';

// Kho vật tư → Phân quyền kho: giao 8 việc kho cho từng người (thay màn Người phụ trách V1-2). Chỉ Admin sửa.
const WmsOwners: React.FC = () => (
  <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    <header className="flex min-w-0 items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Settings2 size={22} /></span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Phân quyền kho</h1>
        <p className="text-sm text-muted-foreground">Ai làm được việc gì trong kho: xem, thủ kho, cấp mã, duyệt ngoại lệ, kế toán kho. Chỉ Admin sửa.</p>
      </div>
    </header>
    <WmsAccessView />
  </main>
);

export default WmsOwners;
