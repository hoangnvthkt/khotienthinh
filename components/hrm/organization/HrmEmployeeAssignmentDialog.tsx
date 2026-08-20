import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, UserRoundCheck, X } from 'lucide-react';
import type {
  HrmSharedEmployee,
  HrmSharedOrgUnit,
  HrmSharedPosition,
  HrmStaffingRow,
} from '../../../types/hrmSharedCatalog';
import SearchableSelect from '../../common/SearchableSelect';
import { getHrmWorkforceErrorMessage } from './HrmStaffingDialog';

export interface HrmEmployeeAssignmentDialogSubmitInput {
  employeeId: string;
  row: HrmStaffingRow;
  effectiveFrom: string;
  note: string;
}

export interface HrmEmployeeAssignmentDialogProps {
  isOpen: boolean;
  employees: HrmSharedEmployee[];
  orgUnits: HrmSharedOrgUnit[];
  positions: HrmSharedPosition[];
  rows: HrmStaffingRow[];
  selectedEmployeeId?: string | null;
  initialRow?: HrmStaffingRow | null;
  allowUnassign?: boolean;
  onClose(): void;
  onSubmit(input: HrmEmployeeAssignmentDialogSubmitInput): void | Promise<void>;
  onUnassign?(input: { employeeId: string; effectiveTo: string; note: string }): void | Promise<void>;
}

const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500';
const labelClass = 'mb-1.5 block text-xs font-black text-slate-700';

const HrmEmployeeAssignmentDialog: React.FC<HrmEmployeeAssignmentDialogProps> = ({
  isOpen,
  employees,
  orgUnits,
  positions,
  rows,
  selectedEmployeeId,
  initialRow,
  allowUnassign = false,
  onClose,
  onSubmit,
  onUnassign,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const [employeeId, setEmployeeId] = useState('');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [rowKey, setRowKey] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [note, setNote] = useState('');
  const [unassignMode, setUnassignMode] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const positionById = useMemo(() => new Map(positions.map(position => [position.id, position])), [positions]);
  const availableRows = useMemo(
    () => rows.filter(row => row.vacantCount > 0 || row.key === initialRow?.key),
    [initialRow?.key, rows],
  );
  const unitRows = availableRows.filter(row => row.orgUnitId === orgUnitId);

  useEffect(() => {
    if (!isOpen) return;
    setEmployeeId(selectedEmployeeId || '');
    setOrgUnitId(initialRow?.orgUnitId || '');
    setRowKey(initialRow?.key || '');
    setEffectiveDate(today);
    setNote('');
    setUnassignMode(false);
    setError('');
    setSaving(false);
  }, [initialRow, isOpen, selectedEmployeeId, today]);

  if (!isOpen) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedNote = note.trim();
    if (!employeeId || !effectiveDate || effectiveDate > today || !trimmedNote) {
      setError('Cần chọn nhân sự, ngày hiệu lực hợp lệ và nhập lý do.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (unassignMode) {
        if (!onUnassign) throw new Error('Không thể gỡ phân bổ trong màn hình này.');
        await onUnassign({ employeeId, effectiveTo: effectiveDate, note: trimmedNote });
        return;
      }
      const selectedRow = availableRows.find(row => row.key === rowKey);
      if (!selectedRow) throw new Error('Cần chọn đơn vị và vị trí còn chỗ trống.');
      await onSubmit({ employeeId, row: selectedRow, effectiveFrom: effectiveDate, note: trimmedNote });
    } catch (submitError) {
      setError(getHrmWorkforceErrorMessage(submitError, 'Không thể phân bổ hoặc chuyển vị trí nhân sự.'));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1210] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
              {unassignMode ? <ArrowRightLeft size={20} /> : <UserRoundCheck size={20} />}
            </span>
            <div>
              <h2 className="text-lg font-black text-slate-900">
                {unassignMode ? 'Gỡ khỏi cơ cấu tổ chức' : 'Phân bổ hoặc chuyển vị trí'}
              </h2>
              <p className="mt-0.5 text-sm font-medium text-slate-500">
                {unassignMode ? 'Nhân sự sẽ chuyển về trạng thái chờ phân bổ.' : 'Chọn đơn vị và vị trí công việc đích.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50" aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="hrm-assignment-employee">Nhân sự</label>
            <SearchableSelect
              value={employeeId}
              options={employees}
              onChange={emp => setEmployeeId(emp ? emp.id : '')}
              getOptionValue={emp => emp.id}
              getOptionLabel={emp => `${emp.fullName} (${emp.employeeCode})`}
              getOptionSearchText={emp => `${emp.fullName} ${emp.employeeCode} ${emp.title || ''}`}
              renderOption={emp => (
                <div className="flex items-center justify-between gap-2 py-0.5">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{emp.fullName}</span>
                    <span className="ml-2 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                      ({emp.employeeCode})
                    </span>
                  </div>
                  {emp.title && (
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {emp.title}
                    </span>
                  )}
                </div>
              )}
              placeholder="Gõ để tìm nhân sự (tên, mã nhân viên)..."
              emptyLabel="Không tìm thấy nhân sự phù hợp"
              disabled={Boolean(selectedEmployeeId)}
              clearable={!Boolean(selectedEmployeeId)}
              className="w-full"
              inputClassName={fieldClass}
            />
          </div>

          {!unassignMode && (
            <>
              <div>
                <label className={labelClass} htmlFor="hrm-assignment-unit">Đơn vị trực thuộc</label>
                <select id="hrm-assignment-unit" value={orgUnitId} onChange={event => {
                  setOrgUnitId(event.target.value);
                  setRowKey('');
                }} className={fieldClass}>
                  <option value="">Chọn đơn vị</option>
                  {orgUnits.filter(unit => unit.isActive && availableRows.some(row => row.orgUnitId === unit.id)).map(unit => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="hrm-assignment-position">Vị trí công việc</label>
                <select id="hrm-assignment-position" value={rowKey} onChange={event => setRowKey(event.target.value)} className={fieldClass} disabled={!orgUnitId}>
                  <option value="">Chọn vị trí còn trống</option>
                  {unitRows.map(row => (
                    <option key={row.key} value={row.key}>
                      {positionById.get(row.positionId)?.name || 'Vị trí'} ({row.levelCode || 'chưa cấp bậc'}, còn {row.vacantCount})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className={unassignMode ? 'sm:col-span-2' : ''}>
            <label className={labelClass} htmlFor="hrm-assignment-date">Ngày hiệu lực</label>
            <input id="hrm-assignment-date" type="date" max={today} value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} className={fieldClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="hrm-assignment-note">Lý do</label>
            <textarea id="hrm-assignment-note" rows={3} required value={note} onChange={event => setNote(event.target.value)} className={`${fieldClass} resize-none`} placeholder={unassignMode ? 'Ví dụ: Chờ quyết định điều chuyển' : 'Ví dụ: Điều chuyển theo quyết định đã duyệt'} />
          </div>
          {error && <p className="sm:col-span-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
          <div>
            {allowUnassign && onUnassign && employeeId && (
              <button type="button" onClick={() => {
                setUnassignMode(value => !value);
                setError('');
                setNote('');
              }} disabled={saving} className="whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-50">
                {unassignMode ? 'Quay lại phân bổ' : 'Gỡ khỏi tổ chức'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">Huỷ</button>
            <button type="submit" disabled={saving} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black text-white disabled:opacity-60 ${unassignMode ? 'bg-red-700 hover:bg-red-800' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? 'Đang xử lý' : unassignMode ? 'Xác nhận gỡ' : 'Xác nhận phân bổ'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
};

export default HrmEmployeeAssignmentDialog;
