import React, { useId } from 'react';
import { Plus } from 'lucide-react';
import type { DailyLogContribution } from '../../../types';
import { toggleDailyLogSourceSelection } from '../../../lib/dailyLogWorkflow';
import { formatDailyLogTime } from '../../../lib/dailyLogPresentation';

export interface DailyLogSourcePickerProps {
  sources: DailyLogContribution[];
  selectedIds: string[];
  selectionMode: 'single' | 'multiple';
  onChange: (ids: string[]) => void;
  onCreateArea?: () => void;
}

const statusLabels = { draft: 'Nháp', submitted: 'Đã gửi', returned: 'Cần sửa', included: 'Đã tổng hợp' };

export const DailyLogSourcePicker: React.FC<DailyLogSourcePickerProps> = ({ sources, selectedIds, selectionMode, onChange, onCreateArea }) => {
  const id = useId();
  return <fieldset className="daily-log-source-picker m-0 min-w-0 border-0 p-0">
    <legend className="mb-3 text-sm font-semibold">{selectionMode === 'single' ? 'Chọn phiếu của bạn' : 'Chọn phiếu để tổng hợp'}</legend>
    {sources.length === 0 && <p className="mb-3 text-sm text-muted-foreground">Chưa có phiếu cho ngày này.</p>}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {sources.map(source => {
        const checked = selectedIds.includes(source.id);
        const blocked = selectionMode === 'multiple' && source.status !== 'submitted' && source.status !== 'included';
        const reasonId = `${id}-${source.id}-reason`;
        return <label key={source.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${checked ? 'border-teal-700 bg-teal-50 dark:bg-teal-950' : 'border-border bg-card'}`}>
          <input type={selectionMode === 'single' ? 'radio' : 'checkbox'} name={`${id}-source`} value={source.id}
            disabled={blocked && !checked} checked={checked} aria-describedby={blocked ? reasonId : undefined}
            className="mt-1 h-4 w-4 shrink-0 accent-teal-700"
            onChange={() => onChange(toggleDailyLogSourceSelection({ sources, selectedIds, sourceId: source.id, selectionMode }))} />
          <span className="min-w-0 flex-1 break-words">
            <span className="block font-semibold">{source.workAreaName?.trim() || 'Chưa xác định khu vực'}</span>
            <span className="block text-muted-foreground">{source.authorName?.trim() || 'Chưa xác định người lập'}</span>
            <span className="mt-1 block">{statusLabels[source.status]} · {formatDailyLogTime(source.submittedAt || source.createdAt)}</span>
            {source.returnReason && <span className="mt-2 block">Lý do cần sửa: {source.returnReason}</span>}
            {blocked && <span id={reasonId} className="mt-2 block text-muted-foreground">{source.status === 'returned' ? 'Chờ kỹ sư sửa và gửi lại; chưa thể đưa vào bản tổng hợp.' : 'Phiếu nháp chưa gửi; chưa thể đưa vào bản tổng hợp.'}</span>}
          </span>
        </label>;
      })}
    </div>
    {onCreateArea && <button type="button" onClick={onCreateArea} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium">
      <Plus size={16} aria-hidden="true" />Tạo phiếu khu vực khác
    </button>}
  </fieldset>;
};
