import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ProjectV2PlanDiscussion } from '../../components/project-v2/ProjectV2PlanDiscussion';
import { ProjectV2PlanActivity } from '../../components/project-v2/ProjectV2PlanActivity';
import { projectV2ReadService } from '../../lib/projectV2/readService';

projectV2ReadService.getCollaborationPage = async (_planId, kind, _limit, cursor) => ({
  asOf: '2026-09-24T08:00:00Z',
  items: kind === 'comments' ? cursor ? [{ kind: 'comments' as const, id: 'comment-older',
    revision: 1, authorUserId: 'u2', body: 'Đã đối chiếu khối lượng.',
    createdAt: '2026-09-23T07:00:00Z' }] : [{ kind: 'comments' as const, id: 'comment-new',
    revision: 2, authorUserId: 'u1', body: 'Cần kiểm tra nguồn vật tư trước khi duyệt.',
    createdAt: '2026-09-24T08:00:00Z' }]
    : [{ kind: 'events' as const, id: 'event-1', revision: 2, eventType: 'approved',
      actorUserId: 'u2', reason: 'Đã xác nhận', metadata: {}, occurredAt: '2026-09-24T07:00:00Z' }],
  nextCursor: kind === 'comments' && !cursor ? { at: '2026-09-24T08:00:00Z', id: 'comment-new' } : null,
});

function Fixture() {
  const [dirty, setDirty] = useState(false);
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
    <header className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Kế hoạch vật tư · VT-2026-10 · bản 2</p>
      <h1 className="mt-1 text-2xl font-bold">Vật tư công trường Riverside</h1>
      <p className="mt-2 text-sm text-slate-500">Nguồn kế hoạch, trao đổi và hoạt động</p>
    </header>
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Kế hoạch nguồn</h2><a href="#month-plan" className="mt-3 block break-words rounded-xl border border-teal-200 p-3 text-sm font-semibold text-teal-800">KT-2026-10 · Kế hoạch tháng · bản 1</a></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Kế hoạch sử dụng tiếp</h2><p className="mt-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-500">Tài liệu liên quan được bảo vệ</p></section>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dirty} onChange={event => setDirty(event.target.checked)} />Biểu mẫu đang sửa</label>
    <ProjectV2PlanDiscussion planId="plan-1" version={2} names={{ u1: 'Nguyễn An', u2: 'Trần Bình' }}
      formDirty={dirty} readOnly={false} onDraftChange={() => {}} onChanged={() => {}}
      onError={() => {}} />
    <ProjectV2PlanActivity planId="plan-1" names={{ u1: 'Nguyễn An', u2: 'Trần Bình' }} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
