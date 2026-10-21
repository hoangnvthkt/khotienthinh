// Dữ liệu minh họa (rút từ DA29 19/10), chỉ dùng cho kiểm thử giao diện "Việc chậm quá 3 ngày". Không gọi Supabase.
// ?n=many để xem 120 việc; ?mode=summarize cho người tổng hợp; ?later=1 khi đã có lý do công bố ở phiếu sau; ?theme=dark.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import '../../components/project/daily-log/daily-log-document.css';
import type { ProjectTask } from '../../types';
import { taskService } from '../../lib/projectService';
import { dailyLogWbsService } from '../../lib/dailyLogWbsService';
import { DelayReasonsSection, type DelayReasonsState } from '../../components/project/schedule-variance/DelayReasonsSection';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');

const task = (id: string, name: string, startDate: string, endDate: string, extra: Partial<ProjectTask> = {}): ProjectTask =>
  ({ id, name, wbsCode: id, startDate, endDate, duration: 0, progress: 0, isMilestone: false, order: 0, ...extra } as ProjectTask);
const groups: Array<[string, string, Array<[string, string, string, string, number]>]> = [
  ['2.1', 'Móng, dầm móng, giằng tường móng', [['2.1.8', 'Gia công, lắp dựng cốt thép, ván khuôn tường móng', '2026-09-28', '2026-10-02', 0], ['2.1.9', 'Đổ bê tông giằng tường móng (BT thương phẩm, đổ thủ công)', '2026-09-30', '2026-10-02', 0]]],
  ['3.3', 'Cột tầng 1, dầm sàn tầng 2', [['3.3.4', 'Gia công, lắp dựng ván khuôn dầm sàn tầng 2', '2026-10-02', '2026-10-06', 0]]],
  ['4.1.1', 'Phân đoạn 1 (Trục 1-5)', [['4.1.1.1', 'Đào móng, dầm móng', '2026-08-25', '2026-08-27', 30], ['4.1.1.2', 'Cắt đầu cọc', '2026-08-25', '2026-08-27', 0], ['4.1.1.5', 'Gia công lắp dựng ván khuôn móng, dầm móng', '2026-09-05', '2026-09-10', 95]]],
  ['4.1.2', 'Phân đoạn 2 (Trục 5-9)', [['4.1.2.1', 'Đào móng, dầm móng', '2026-09-10', '2026-09-14', 20], ['4.1.2.2', 'Cắt đầu cọc', '2026-09-10', '2026-09-14', 0], ['4.1.2.4', 'Bê tông lót móng', '2026-09-12', '2026-09-15', 0], ['4.1.2.6', 'Lắp dựng cốt thép móng', '2026-09-14', '2026-09-20', 40]]],
  ['4.1.3', 'Phân đoạn 3 (Trục 9-13)', [['4.1.3.1', 'Đào móng, dầm móng', '2026-09-20', '2026-09-24', 0], ['4.1.3.2', 'Cắt đầu cọc', '2026-09-20', '2026-09-24', 0], ['4.1.3.4', 'Bê tông lót móng', '2026-09-22', '2026-09-26', 0], ['4.1.3.6', 'Lắp dựng cốt thép móng', '2026-09-25', '2026-10-01', 0], ['4.1.3.8', 'Đổ bê tông móng', '2026-10-02', '2026-10-05', 0], ['4.1.3.9', 'Xây tường móng', '2026-10-06', '2026-10-10', 0], ['4.1.3.10', 'Lấp đất hố móng', '2026-10-08', '2026-10-12', 0]]],
];
const many = params.get('n') === 'many';
const tasks: ProjectTask[] = [];
const roots = new Set<string>();
for (const [code, name, leaves] of many ? Array.from({ length: 6 }, (_, k) => groups.map(([c, n, l]) => [`${k + 1}.${c}`, `${n} · khối ${k + 1}`, l.map(([lc, ...rest]) => [`${k + 1}.${lc}`, ...rest])] as typeof groups[number])).flat() : groups) {
  const root = code.split('.').slice(0, -1).join('.') || code;
  if (!roots.has(root)) { roots.add(root); tasks.push(task(root, `Hạng mục ${root}`, '2026-08-20', '2026-12-30')); }
  tasks.push(task(code, name, leaves[0][2], leaves[leaves.length - 1][3], { parentId: root }));
  // Mỗi việc tách rời (chồng ngày) để đều là việc gây chậm.
  leaves.forEach(([id, leafName, start, end, progress]) => tasks.push(task(id, leafName, start, end, { parentId: code, progress, startDate: start })));
}
const catalog = [
  { code: 'design', label: 'Thay đổi thiết kế (CĐT)', defaultParty: 'owner' }, { code: 'scope', label: 'Phát sinh khối lượng', defaultParty: 'owner' },
  { code: 'method', label: 'Đổi biện pháp thi công', defaultParty: 'company' }, { code: 'material', label: 'Chậm do vật tư', defaultParty: 'vendor' },
  { code: 'labor', label: 'Chậm do nhân công, máy', defaultParty: 'company' }, { code: 'site', label: 'Mặt bằng, việc trước chưa bàn giao', defaultParty: 'owner' },
  { code: 'owner', label: 'CĐT chậm duyệt, chậm thanh toán', defaultParty: 'owner' }, { code: 'weather', label: 'Thời tiết', defaultParty: 'objective' },
];
const later = params.get('later') ? [{ taskId: '4.1.1.1', reasonCode: 'site', responsibleParty: 'owner' as const, logDate: '2026-10-20', updatedByName: 'Nguyễn Văn Năm', status: 'published' as const }] : [];
taskService.list = async () => tasks;
dailyLogWbsService.getDelayReasons = async input => ({ catalog, draft: [], latest: input.dailyLogId ? [] : later });

const App = () => {
  const [state, setState] = useState<DelayReasonsState | null>(null);
  // Giả lập vỏ nhật ký: trên điện thoại thanh Duyệt & công bố cố định đáy màn hình.
  return <div className="daily-log-document min-h-screen bg-background">
    <header className="daily-log-document-header"><div className="daily-log-document-heading"><h2>Bản tổng hợp thi công ngày</h2></div>
      <div className="daily-log-document-actionbar"><div className="daily-log-document-buttons flex"><button type="button" disabled className="daily-log-document-button rounded-lg bg-zinc-200 px-4 text-sm font-semibold">Duyệt & công bố</button></div>
        <p className="daily-log-document-action-reason">{state?.missing ? `Chọn lý do cho ${state.missing} việc chậm trước khi duyệt.` : 'Sẵn sàng duyệt.'}</p></div></header>
    <div className="daily-log-document-body mx-auto max-w-4xl space-y-3 p-3 sm:p-6">
    <DelayReasonsSection projectId="da29" constructionSiteId={null} dailyLogId="log-19" logDate="2026-10-19" progressByTask={new Map()}
      engineerNotes={new Map([['4.1.2.6', 'thiếu thợ sắt 2 ngày']])} editable mode={params.get('mode') === 'summarize' ? 'summarize' : 'review'} onChange={setState} />
    <p data-testid="state" className="text-xs text-muted-foreground">{state ? `${state.entries.length} lý do · còn ${state.missing}` : '—'}</p>
    <div className="h-[60vh]" />
  </div></div>;
};
createRoot(document.getElementById('root')!).render(<App />);
