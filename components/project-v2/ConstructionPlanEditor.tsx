import React from 'react';
import type { ConstructionCandidate, ProjectV2Crew } from '../../lib/projectV2/candidateService';
import { formatDecimal6, parseQuantity6 } from '../../lib/procurement/decimal';

export interface ConstructionEntry { quantity: string; start: string; end: string; crewId: string }
export function ConstructionPlanEditor({ rows, entries, onChange, crews, periodStart, periodEnd }: {
  rows: ConstructionCandidate[]; entries: Record<string, ConstructionEntry>;
  onChange: (id: string, entry: ConstructionEntry) => void; crews: ProjectV2Crew[];
  periodStart: string; periodEnd: string;
}) {
  return <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
    <p className="px-3 py-2 text-xs text-slate-500 sm:hidden">Vuốt ngang để xem và nhập đủ các cột.</p><div className="w-full overflow-x-auto">
    <table className="w-full min-w-[950px] border-collapse text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>
        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 dark:bg-slate-800">Công việc</th><th className="px-3 py-3">Nguồn tháng</th>
        <th className="px-3 py-3">Đơn vị</th><th className="px-3 py-3">Khối lượng khả dụng</th>
        <th className="px-3 py-3">Khối lượng tuần</th><th className="px-3 py-3">Bắt đầu</th>
        <th className="px-3 py-3">Kết thúc</th><th className="px-3 py-3">Tổ đội</th>
      </tr></thead><tbody>{rows.map(row => {
        const entry = entries[row.sourceLineId] ?? { quantity: '', start: periodStart, end: periodEnd, crewId: '' };
        const update = (patch: Partial<ConstructionEntry>) => onChange(row.sourceLineId, { ...entry, ...patch });
        const invalidDate = Boolean(entry.start && entry.end && (entry.end < entry.start ||
          entry.start < periodStart || entry.end > periodEnd));
        return <tr key={row.sourceLineId} className="border-t border-slate-100 align-top dark:border-slate-700">
          <td className="sticky left-0 z-10 bg-white px-3 py-3 font-medium dark:bg-slate-900">{row.title}</td><td className="px-3 py-3">{row.code} · bản {row.sourceRevision}</td>
          <td className="px-3 py-3">{row.sourceUnit ?? '—'}</td><td className="whitespace-nowrap px-3 py-3 tabular-nums">{row.availableQuantity === null ? 'Chưa xác định' : formatDecimal6(parseQuantity6(row.availableQuantity))}</td>
          <td className="px-3 py-3"><input aria-label={`Khối lượng tuần ${row.code}`} inputMode="decimal" value={entry.quantity}
            onChange={event => update({ quantity: event.target.value })} className="w-28 rounded-lg border border-slate-300 px-2 py-2 dark:border-slate-600 dark:bg-slate-800" /></td>
          <td className="px-3 py-3"><input aria-label={`Bắt đầu ${row.code}`} type="date" min={periodStart} max={periodEnd} value={entry.start}
            onChange={event => update({ start: event.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 dark:border-slate-600 dark:bg-slate-800" /></td>
          <td className="px-3 py-3"><input aria-label={`Kết thúc ${row.code}`} type="date" min={periodStart} max={periodEnd} value={entry.end}
            onChange={event => update({ end: event.target.value })} aria-invalid={invalidDate}
            className="rounded-lg border border-slate-300 px-2 py-2 dark:border-slate-600 dark:bg-slate-800" />
            {invalidDate && <span className="block text-xs text-red-700">Ngày phải nằm trong kỳ và sau ngày bắt đầu</span>}</td>
          <td className="px-3 py-3"><select aria-label={`Tổ đội ${row.code}`} value={entry.crewId}
            onChange={event => update({ crewId: event.target.value })}
            className="w-32 rounded-lg border border-slate-300 px-2 py-2 dark:border-slate-600 dark:bg-slate-800">
            <option value="">Chưa phân công</option>{crews.map(crew => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
          </select></td>
        </tr>;
      })}</tbody></table>
  </div></div>;
}
