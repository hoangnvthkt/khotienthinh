import React, { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Loader2, X } from 'lucide-react';
import type {
  HrmSharedCodeItem,
  HrmSharedOrgUnit,
  HrmSharedPosition,
  HrmStaffingRow,
} from '../../../types/hrmSharedCatalog';
import SearchableSelect from '../../common/SearchableSelect';

export const getHrmWorkforceErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('HRM_STAFFING_NO_VACANCY')) {
    return 'Định biên này đã đủ người. Hãy tăng định biên hoặc chọn vị trí khác.';
  }
  if (message.includes('HRM_STAFFING_HAS_OCCUPIED_OR_MANAGER_SLOTS')) {
    return 'Không thể giảm định biên vì vẫn còn nhân viên hoặc vị trí quản lý đang được sử dụng.';
  }
  if (message.includes('HRM_MANAGER_STAFFING_MUST_HAVE_ONE_SLOT')) {
    return 'Vị trí quản lý phải có định biên đúng một người.';
  }
  if (message.includes('HRM_SLOT_REPORTING_CYCLE')) {
    return 'Không thể tạo tuyến báo cáo vòng lặp.';
  }
  if (message.includes('HRM_ACTIVE_ORG_UNIT_NOT_FOUND') || message.includes('HRM_ACTIVE_POSITION_NOT_FOUND')) {
    return 'Đơn vị hoặc vị trí đã ngưng sử dụng.';
  }
  if (message.includes('23505') || message.toLocaleLowerCase('vi').includes('duplicate')) {
    return 'Nhân viên đã được người khác phân bổ. Vui lòng làm mới dữ liệu.';
  }
  return message && !message.startsWith('HRM_') ? message : fallback;
};

export interface HrmStaffingDialogSubmitInput {
  positionId: string;
  levelCode: string | null;
  targetCount: number;
  reportsToSlotId: string | null;
  note: string;
}

export interface HrmStaffingDialogProps {
  isOpen: boolean;
  unit: HrmSharedOrgUnit | null;
  row?: HrmStaffingRow | null;
  positions: HrmSharedPosition[];
  positionLevels: HrmSharedCodeItem[];
  reportingRows: HrmStaffingRow[];
  onClose(): void;
  onSubmit(input: HrmStaffingDialogSubmitInput): void | Promise<void>;
}

const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500';
const labelClass = 'mb-1.5 block text-xs font-black text-slate-700';

const HrmStaffingDialog: React.FC<HrmStaffingDialogProps> = ({
  isOpen,
  unit,
  row,
  positions,
  positionLevels,
  reportingRows,
  onClose,
  onSubmit,
}) => {
  const [positionId, setPositionId] = useState('');
  const [levelCode, setLevelCode] = useState('');
  const [targetCount, setTargetCount] = useState(1);
  const [reportingRowKey, setReportingRowKey] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const eligibleReportingRows = useMemo(
    () => reportingRows.filter(item => item.isManager || item.plannedCount === 1),
    [reportingRows],
  );
  const positionById = useMemo(() => new Map(positions.map(position => [position.id, position])), [positions]);
  const positionOptions = useMemo(() => {
    const active = positions.filter(position => position.isActive && position.source !== 'legacy');
    if (positionId && !active.some(p => p.id === positionId)) {
      const current = positions.find(p => p.id === positionId);
      if (current) return [current, ...active];
    }
    return active;
  }, [positionId, positions]);

  useEffect(() => {
    if (!isOpen) return;
    setPositionId(row?.positionId || '');
    setLevelCode(row?.levelCode || '');
    setTargetCount(row?.plannedCount || 1);
    const reportingRow = eligibleReportingRows.find(item => item.slots[0]?.id === row?.reportsToSlotId);
    setReportingRowKey(reportingRow?.key || '');
    setNote('');
    setError('');
    setSaving(false);
  }, [eligibleReportingRows, isOpen, row]);

  if (!isOpen || !unit) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!positionId || targetCount < 0 || !note.trim()) {
      setError('Cần chọn vị trí, nhập định biên hợp lệ và lý do thay đổi.');
      return;
    }
    const reportingRow = eligibleReportingRows.find(item => item.key === reportingRowKey);
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        positionId,
        levelCode: levelCode || null,
        targetCount,
        reportsToSlotId: reportingRow?.slots[0]?.id || null,
        note: note.trim(),
      });
    } catch (submitError) {
      setError(getHrmWorkforceErrorMessage(submitError, 'Không thể điều chỉnh định biên nhân sự.'));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1210] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
              <BriefcaseBusiness size={20} />
            </span>
            <div>
              <h2 className="text-lg font-black text-slate-900">{row ? 'Điều chỉnh định biên' : 'Thiết lập định biên'}</h2>
              <p className="mt-0.5 text-sm font-medium text-slate-500">{unit.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50" aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="hrm-staffing-position">Vị trí công việc</label>
            <SearchableSelect
              value={positionId}
              options={positionOptions}
              onChange={selected => {
                const nextId = selected ? selected.id : '';
                setPositionId(nextId);
                setLevelCode(selected?.levelCode || '');
              }}
              getOptionValue={pos => pos.id}
              getOptionLabel={pos => pos.name}
              getOptionSearchText={pos => `${pos.code || ''} ${pos.name} ${pos.levelCode || ''}`}
              renderOption={pos => (
                <div className="flex items-center justify-between gap-2 py-0.5">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{pos.name}</span>
                    {pos.code && (
                      <span className="ml-2 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                        {pos.code}
                      </span>
                    )}
                  </div>
                  {pos.levelCode && (
                    <span className="shrink-0 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                      {pos.levelCode}
                    </span>
                  )}
                </div>
              )}
              placeholder="Gõ để tìm vị trí công việc..."
              emptyLabel="Không tìm thấy vị trí phù hợp"
              disabled={Boolean(row)}
              clearable={!Boolean(row)}
              className="w-full"
              inputClassName={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="hrm-staffing-level">Cấp bậc</label>
            <select id="hrm-staffing-level" value={levelCode} onChange={event => setLevelCode(event.target.value)} className={fieldClass}>
              <option value="">Chưa thiết lập</option>
              {positionLevels.filter(level => level.isActive).map(level => (
                <option key={level.id} value={level.code}>{level.code} - {level.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="hrm-staffing-count">Định biên</label>
            <input id="hrm-staffing-count" type="number" min={0} step={1} value={targetCount} onChange={event => setTargetCount(Number(event.target.value))} className={fieldClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="hrm-staffing-reporting">Báo cáo tới vị trí</label>
            <select id="hrm-staffing-reporting" value={reportingRowKey} onChange={event => setReportingRowKey(event.target.value)} className={fieldClass}>
              <option value="">Theo quản lý của đơn vị</option>
              {eligibleReportingRows.map(item => (
                <option key={item.key} value={item.key}>
                  {positionById.get(item.positionId)?.name || 'Vị trí quản lý'} ({item.levelCode || 'chưa cấp bậc'})
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs font-medium text-slate-500">Chỉ hiển thị vị trí quản lý hoặc vị trí có định biên một người.</p>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="hrm-staffing-note">Lý do thay đổi</label>
            <textarea id="hrm-staffing-note" rows={3} required value={note} onChange={event => setNote(event.target.value)} className={`${fieldClass} resize-none`} placeholder="Ví dụ: Bổ sung định biên theo kế hoạch nhân sự đã duyệt" />
          </div>
          {error && <p className="sm:col-span-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{error}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">Huỷ</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? 'Đang lưu' : 'Lưu định biên'}
          </button>
        </footer>
      </form>
    </div>
  );
};

export default HrmStaffingDialog;
