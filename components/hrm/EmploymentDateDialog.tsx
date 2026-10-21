import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarCheck, Loader2, UserMinus, X } from 'lucide-react';
import type { Employee } from '../../types';
import { useToast } from '../../context/ToastContext';
import { ENT, viDate } from '../finance/financeUi';
import { inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import EmploymentDateFields from './EmploymentDateFields';
import {
  RESIGNED, emptyWorkStatusInput, hrmWorkStatusService, validateEmploymentDate, workStatusErrorMessage,
} from '../../lib/hrmWorkStatus';

interface Props {
  employee: Employee;
  /** exit = cho nghỉ việc (đang làm) hoặc bổ sung ngày nghỉ (đã nghỉ); start = bổ sung ngày vào làm. */
  kind: 'exit' | 'start';
  onClose: () => void;
  onSaved: (employee: Employee) => void;
}

/** Small dialog for one date: used by Danh bạ ("Cho nghỉ việc"), the profile form and the "Thiếu ngày công tác" list. */
const EmploymentDateDialog: React.FC<Props> = ({ employee, kind, onClose, onSaved }) => {
  const toast = useToast();
  const [value, setValue] = useState(emptyWorkStatusInput);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const filling = kind === 'exit' && employee.status === RESIGNED;
  const title = kind === 'start' ? 'Bổ sung ngày vào làm' : filling ? 'Bổ sung ngày nghỉ việc' : 'Cho nghỉ việc';
  const action = kind === 'start' ? 'Lưu ngày vào làm' : filling ? 'Lưu ngày nghỉ' : 'Cho nghỉ việc';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateEmploymentDate(kind, value, { startDate: employee.startDate, exitDate: employee.exitDate });
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      if (kind === 'start') {
        await hrmWorkStatusService.setStartDate(employee, value.date);
        onSaved({ ...employee, startDate: value.date });
        toast.success(`Đã ghi ngày vào làm ${viDate(value.date)}`, employee.fullName);
      } else {
        const result = await hrmWorkStatusService.setStatus(employee, RESIGNED, value);
        onSaved({ ...employee, status: result.status, exitDate: result.exitDate || value.date });
        toast.success(`Đã ghi nghỉ việc từ ${viDate(value.date)}`, employee.fullName);
      }
      onClose();
    } catch (err) {
      setError(workStatusErrorMessage(err, 'Không lưu được. Thử lại.'));
    } finally {
      setSaving(false);
    }
  };

  // Portal: the dialog also opens from inside the profile form, whose mobile CSS restyles nested divs.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}
      onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form onSubmit={submit} noValidate className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start gap-3 p-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${kind === 'start'
            ? 'bg-mint-100 text-mint-700 dark:bg-mint-900/40 dark:text-mint-300'
            : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'}`}>
            {kind === 'start' ? <CalendarCheck size={20} /> : <UserMinus size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-800 dark:text-white">{title}</h2>
            <p className="truncate text-sm">
              <span className={ENT}>{employee.fullName}</span>
              {employee.employeeCode && <span className="ml-1.5 font-mono text-xs text-slate-400">{employee.employeeCode}</span>}
            </p>
            <p className="text-xs text-slate-500">
              {employee.startDate ? `Vào làm ${viDate(employee.startDate)}` : 'Chưa có ngày vào làm'}
              {employee.exitDate ? ` · Nghỉ ${viDate(employee.exitDate)}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Đóng"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-4 pb-4">
          <EmploymentDateFields kind={kind} value={value} onChange={next => { setValue(next); setError(null); }} error={error}
            inputClassName={`${inputCls} w-full py-2`} bounded minDate={kind === 'exit' ? employee.startDate : null} autoFocus />
        </div>
        <div className="flex gap-2 border-t border-slate-100 p-4 dark:border-slate-800 sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className={`${secondaryBtn} flex-1 sm:flex-none`}>Hủy</button>
          <button type="submit" disabled={saving} className={`${primaryBtn} flex-1 sm:flex-none`}>
            {saving && <Loader2 size={16} className="animate-spin" />}{saving ? 'Đang lưu…' : action}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

export default EmploymentDateDialog;
