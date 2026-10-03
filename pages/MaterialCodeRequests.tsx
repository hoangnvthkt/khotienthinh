import React from 'react';
import { Hash } from 'lucide-react';
import { CatalogView } from '../components/wms/CatalogView';

// Kho vật tư → Danh mục vật tư (V1): một cửa cấp mã — đề xuất, cấp mã, sửa, ngừng dùng, cách quản lý kho.
const MaterialCodeRequests: React.FC = () => (
  <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    <header className="flex min-w-0 items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Hash size={22} /></span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Danh mục vật tư</h1>
        <p className="text-sm text-muted-foreground">Cấp mã, sửa, ngừng dùng vật tư và đặt cách quản lý kho — một cửa cho toàn công ty.</p>
      </div>
    </header>
    <CatalogView />
  </main>
);

export default MaterialCodeRequests;
