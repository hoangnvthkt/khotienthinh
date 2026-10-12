// Dữ liệu minh họa, chỉ dùng cho kiểm thử giao diện gợi ý "Như hôm qua". Không gọi Supabase.
// ?theme=dark để xem nền tối; ?empty=1 để xem khi không có nhật ký trước (không gợi ý).
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import DailyLogDetailTabs, { type DailyLogDetailPrefill } from '../../components/project/DailyLogDetailTabs';
import type { DailyLogLabor, DailyLogMachine, ProjectTask } from '../../types';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');

const tasks = [
  { id: 't1', name: 'Bê tông móng M3', wbsCode: '1.2' },
  { id: 't2', name: 'Cốp pha cột tầng 1', wbsCode: '2.1' },
] as ProjectTask[];

const yesterdayLabor: DailyLogLabor[] = [
  { laborType: 'Tổ đội', groupName: 'Tổ anh Minh', partnerId: 'p1', partnerName: 'Tổ anh Minh', taskId: 't1', taskName: 'Bê tông móng M3', count: 8, hours: 8, unit: 'người' },
  { laborType: 'Thợ cốp pha', catalogItemId: 'c1', catalogCode: 'NC-CP', catalogName: 'Thợ cốp pha', taskId: 't2', taskName: 'Cốp pha cột tầng 1', count: 6, hours: 8, unit: 'công', unitCost: 450000 },
  { laborType: 'Tổ đội', groupName: 'Tổ anh Hải (sắt)', partnerId: 'p2', partnerName: 'Tổ anh Hải (sắt)', taskId: 't1', taskName: 'Bê tông móng M3', count: 5, hours: 8, unit: 'người' },
];
const yesterdayMachines: DailyLogMachine[] = [
  { machineName: 'Máy đào bánh xích 0,8 m³', machineType: 'excavator', catalogItemId: 'm1', catalogCode: 'MD08', catalogName: 'Máy đào bánh xích 0,8 m³', taskId: 't1', taskName: 'Bê tông móng M3', partnerName: 'Chủ máy anh Nam', shifts: 1, hours: 8 },
  { machineName: 'Máy đầm dùi', machineType: 'other', catalogName: 'Máy đầm dùi', taskId: 't1', taskName: 'Bê tông móng M3', shifts: 1, hours: 4 },
];

const log = (field: string, outcome: string, rows: number) => {
  const el = document.getElementById('events');
  if (el) el.textContent = `${el.textContent}${field} · ${outcome} · ${rows} dòng\n`;
};

const Fixture: React.FC = () => {
  const [labor, setLabor] = useState<DailyLogLabor[]>([]);
  const [machines, setMachines] = useState<DailyLogMachine[]>([]);
  const [sourceDate, setSourceDate] = useState('2026-10-11');
  const prefill: DailyLogDetailPrefill | undefined = params.get('empty') ? undefined : {
    sourceLogId: `log-${sourceDate}`,
    sourceLabel: `nhật ký ${Number(sourceDate.slice(8))}/${Number(sourceDate.slice(5, 7))} của bạn`,
    labor: yesterdayLabor,
    machines: yesterdayMachines,
    onAccept: (field, rows) => log(field, 'accepted', rows),
    onDismiss: (field, rows) => log(field, 'dismissed', rows),
  };
  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6">
      <div className="mx-auto max-w-4xl rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-black">Ghi nhật ký chi tiết · 12/10/2026</div>
          <div className="flex gap-2">
            <button type="button" className="px-2.5 py-1 rounded-lg border border-border text-xs font-bold" onClick={() => setSourceDate(d => d === '2026-10-11' ? '2026-10-10' : '2026-10-11')}>Đổi ngày (nguồn khác)</button>
            <button type="button" className="px-2.5 py-1 rounded-lg border border-border text-xs font-bold" onClick={() => { setLabor([]); setMachines([]); }}>Xóa dòng</button>
          </div>
        </div>
        <DailyLogDetailTabs
          prefill={prefill}
          volumes={[]} materials={[]} laborDetails={labor} machines={machines}
          onVolumesChange={() => {}} onMaterialsChange={() => {}} onLaborChange={setLabor} onMachinesChange={setMachines}
          tasks={tasks}
        />
        <pre id="events" className="mt-3 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap min-h-[2rem]" aria-label="Sự kiện đo" />
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Fixture />);
