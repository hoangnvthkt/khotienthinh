import React, { useMemo, useState } from 'react';
import { candidateUnavailableReason, filterCandidates, presentSourceReason, selectDisplayed } from '../../lib/projectV2/sourcePicker';
import type { ConstructionCandidate, MonthCandidate } from '../../lib/projectV2/candidateService';
import { formatProjectV2Quantity } from '../../lib/projectV2/presentation';

type Props = {
  workspaceId: string; type: 'month' | 'construction';
  monthCandidates?: MonthCandidate[]; constructionCandidates?: ConstructionCandidate[];
  selectedIds: string[]; onChange: (ids: string[]) => void;
};

export function ProjectV2SourcePicker({ workspaceId, type, monthCandidates = [],
  constructionCandidates = [], selectedIds, onChange }: Props) {
  const [search, setSearch] = useState('');
  const displayed = useMemo(() => type === 'construction'
    ? filterCandidates(constructionCandidates, workspaceId, search)
    : monthCandidates.filter(row => row.workspaceId === workspaceId &&
      `${row.code} ${row.title}`.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))),
  [type, constructionCandidates, monthCandidates, workspaceId, search]);
  const getId = (row: MonthCandidate | ConstructionCandidate) =>
    'sourceLineId' in row ? row.sourceLineId : row.contractItemId;
  const currentIds = new Set((type === 'construction' ? constructionCandidates : monthCandidates).map(getId));
  const missingCount = selectedIds.filter(id => !currentIds.has(id)).length;
  const reason = (row: MonthCandidate | ConstructionCandidate) => {
    if ('sourceLineId' in row) return candidateUnavailableReason(row, workspaceId);
    if (row.isGroup) return 'Nhóm tổng hợp, chọn công việc con';
    if (row.baselineState !== 'verified') return 'Tiến độ gốc chưa được xác nhận';
    if (row.unavailableReason) return presentSourceReason(row.unavailableReason);
    if (row.availableQuantity === null) return 'Chưa xác định khối lượng khả dụng';
    if (Number(row.availableQuantity) <= 0) return 'Đã phân bổ hết';
    return null;
  };
  const selectAll = () => {
    if (type === 'construction') onChange(selectDisplayed(selectedIds, displayed as ConstructionCandidate[], workspaceId));
    else onChange([...new Set([...selectedIds, ...displayed.filter(row => !reason(row)).map(getId)])]);
  };
  return <section className="space-y-3" aria-label="Chọn nguồn kế hoạch">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input aria-label="Tìm nguồn" value={search} onChange={event => setSearch(event.target.value)}
        placeholder="Tìm mã hoặc công việc" className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-800 sm:flex-1" />
      <button type="button" onClick={selectAll} className="min-h-10 w-full rounded-lg border border-teal-700 px-3 text-sm font-semibold text-teal-800 dark:text-teal-300 sm:w-auto">Chọn tất cả kết quả đang hiển thị</button>
    </div>
    <p className="text-xs text-slate-500">Đã chọn {selectedIds.length} dòng · {displayed.length} kết quả đang hiển thị</p>
    {missingCount > 0 && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      {missingCount} nguồn đã chọn không còn trong phiên bản hiện tại. Bỏ chọn hoặc tải lại trước khi lưu.</p>}
    <div className="max-h-64 space-y-2 overflow-y-auto" role="list">
      {displayed.map(row => {
        const id = getId(row); const unavailable = reason(row);
        return <label key={id} role="listitem" className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
          <input type="checkbox" checked={selectedIds.includes(id)} disabled={Boolean(unavailable)}
            onChange={event => onChange(event.target.checked ? [...selectedIds, id] : selectedIds.filter(item => item !== id))}
            className="mt-1 h-4 w-4 accent-teal-700" />
          <span className="min-w-0 flex-1"><strong className="block break-words text-slate-900 dark:text-white">{row.code} · {row.title}</strong>
            <span className="block text-slate-600 dark:text-slate-300">Khả dụng: {row.availableQuantity === null ? 'Chưa xác định' : formatProjectV2Quantity({ state: 'known', value: row.availableQuantity }, ('sourceUnit' in row ? row.sourceUnit : row.unit) ?? '')}</span>
            {unavailable && <span className="block text-amber-700 dark:text-amber-300">{unavailable}</span>}
          </span>
        </label>;
      })}
      {!displayed.length && <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Không có nguồn phù hợp.</p>}
    </div>
  </section>;
}
