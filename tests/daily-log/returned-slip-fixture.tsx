// Dữ liệu minh họa (DA29 13/10), chỉ dùng cho kiểm thử giao diện phiếu bị trả trong ngăn ngày. Không gọi Supabase.
// ?as=author (KS lập phiếu, mặc định) | admin (người khác); ?theme=dark.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { dailyLogWbsService } from '../../lib/dailyLogWbsService';
import type { DailyLogTodayBoard as Board } from '../../lib/dailyLogTodayBoard';
import { DailyLogTodayBoard } from '../../components/project/daily-log/DailyLogTodayBoard';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');
const board: Board = {
  date: '2026-10-13', missingFronts: [], yesterday: null, days: [],
  summary: { id: 'log-13', status: 'rejected', summarizedByName: 'Đoàn Văn Dương' },
  slips: [{
    id: 'slip-nx1', areaCode: 'NX1', areaName: 'Nhà xưởng', authorUserId: 'duong', authorName: 'Đoàn Văn Dương', status: 'returned',
    submittedAt: '2026-10-15T07:54:30Z', returnReason: '4.1.1.9 đã ghi 85% ở nhật ký 12/10, xem lại khối lượng ngày 13/10', returnedByName: 'Admin Hoàng',
    photos: [], photoCount: 0, people: 42, laborHours: 336, machineCount: 4, machineHours: 32,
    items: [{ taskId: 't', wbsCode: '4.1.1.9', taskName: 'Đổ bê tông giằng tường móng, cổ cột (BT thương phẩm, đổ thủ công)', unit: 'm3', cumulativeQuantity: 2.35, cumulativePercent: 85, plannedQuantity: 2.766, forecastFinishDate: '2026-10-15', scheduleFinishDate: '2026-09-30' }],
  }],
};
dailyLogWbsService.getTodayBoard = async () => board;

const App = () => {
  const [opened, setOpened] = useState<string | null>(null);
  return <div className="min-h-screen bg-background p-3 sm:p-6"><div className="mx-auto max-w-5xl space-y-3">
    {opened && <p data-testid="opened" className="rounded-lg bg-teal-50 p-2 text-sm">Mở phiếu {opened}</p>}
    <DailyLogTodayBoard fixedDate="2026-10-13" projectId="da29" userId={params.get('as') === 'admin' ? 'hoang' : 'duong'} canSubmit canSummarize={false} canApprove
      refreshKey={0} onCreate={() => setOpened('mới')} onFixReturned={(_, id) => setOpened(id)} onSummarize={() => undefined} onReview={() => undefined} onOpenPhotos={() => undefined} />
  </div></div>;
};
createRoot(document.getElementById('root')!).render(<App />);
