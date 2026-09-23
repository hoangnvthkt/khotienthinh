import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ProjectV2Shell } from '../../components/project-v2/ProjectV2Shell';
import { ProjectV2PlanList } from '../../components/project-v2/ProjectV2PlanList';
import type { ProjectV2PlanSummary } from '../../lib/projectV2/readService';

const plans: ProjectV2PlanSummary[] = [
  { id: 'plan-1', workspaceId: 'workspace-1', planType: 'month', code: 'KT-2026-10',
    title: 'Kế hoạch khối lượng tháng 10', status: 'pending_approval',
    periodStart: '2026-10-01', periodEnd: '2026-10-31', ownerUserId: 'user-1',
    creatorUserId: 'user-1', submitterUserId: 'user-1', approverUserId: null,
    revision: 2, version: 5, createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z' },
  { id: 'plan-2', workspaceId: 'workspace-1', planType: 'month', code: 'KT-2026-11',
    title: 'Kế hoạch khối lượng tháng 11', status: 'draft',
    periodStart: '2026-11-01', periodEnd: '2026-11-30', ownerUserId: null,
    creatorUserId: 'user-2', submitterUserId: null, approverUserId: null,
    revision: 1, version: 1, createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z' },
];

createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <div className="min-h-screen bg-slate-50">
    <ProjectV2Shell projectName="Dự án Riverside" projectCode="DA29"
      clientName="Công ty Xin Hai Vina" siteName="Công trường Riverside"
      planType="month" primaryAction={<button className="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white">Tạo kế hoạch tháng</button>}>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['Cần anh xem','Tháng hiện tại đã duyệt','Thi công tuần này','Hồ sơ sang Mua hàng'].map((label, index) =>
          <div key={label} className="rounded-2xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-bold">{index === 3 ? '—' : index === 0 ? '1' : '0'}</p></div>)}
      </section>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 space-y-4">
          <div className="flex gap-2 overflow-x-auto"><button className="shrink-0 rounded-xl bg-teal-700 px-4 py-2 text-white">Kế hoạch tháng</button>
            <button className="shrink-0 rounded-xl bg-white px-4 py-2">Thi công</button><button className="shrink-0 rounded-xl bg-white px-4 py-2">Vật tư</button></div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <input placeholder="Tìm mã hoặc tên" className="col-span-2 min-w-0 rounded-xl border bg-white px-3 py-2 xl:col-span-1" />
            <select className="min-w-0 rounded-xl border bg-white px-3 py-2"><option>Mọi trạng thái</option></select>
            <input type="month" className="min-w-0 rounded-xl border bg-white px-3 py-2" />
            <select className="col-span-2 min-w-0 rounded-xl border bg-white px-3 py-2 xl:col-span-1"><option>Mới nhất</option></select>
          </div>
          <ProjectV2PlanList plans={plans} ownerNames={{ 'user-1': 'Nguyễn An', 'user-2': 'Trần Bình' }} />
        </section>
        <aside className="rounded-2xl border bg-white p-4"><h2 className="font-semibold">Cần anh xem</h2>
          <p className="mt-3 text-sm">Kế hoạch khối lượng tháng 10</p></aside>
      </div>
    </ProjectV2Shell>
  </div>
</MemoryRouter>);
