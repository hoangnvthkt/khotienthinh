import React, { useMemo, useState } from 'react';
import { CalendarX2, ChevronDown, ChevronRight } from 'lucide-react';
import type { Employee } from '../../types';
import { ENT, viDate } from '../finance/financeUi';
import { employmentDateGaps } from '../../lib/hrmWorkStatus';
import EmploymentDateDialog from './EmploymentDateDialog';

interface Props {
  employees: Employee[];
  onSaved: (employee: Employee) => void;
}

const fixBtn = 'shrink-0 rounded-lg border border-leaf-300 px-3 py-1.5 text-xs font-semibold text-leaf-700 hover:bg-leaf-50 dark:border-leaf-700 dark:text-leaf-300 dark:hover:bg-leaf-900/30';

/** HR to-do: people the headcount chart cannot place in a month. Hidden once nothing is missing. */
const HrmEmploymentDateGapsPanel: React.FC<Props> = ({ employees, onSaved }) => {
  const gaps = useMemo(() => employmentDateGaps(employees), [employees]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ employee: Employee; kind: 'exit' | 'start' } | null>(null);
  const total = gaps.resignedNoExit.length + gaps.activeNoStart.length;
  if (total === 0 && !editing) return null;

  const groups = [
    { key: 'exit' as const, title: 'Đã nghỉ chưa có ngày nghỉ', people: gaps.resignedNoExit, action: 'Bổ sung ngày nghỉ' },
    { key: 'start' as const, title: 'Đang làm chưa có ngày vào làm', people: gaps.activeNoStart, action: 'Bổ sung ngày vào' },
  ].filter(group => group.people.length > 0);
  const summary = [
    gaps.resignedNoExit.length ? `${gaps.resignedNoExit.length} đã nghỉ chưa có ngày nghỉ` : '',
    gaps.activeNoStart.length ? `${gaps.activeNoStart.length} đang làm chưa có ngày vào làm` : '',
  ].filter(Boolean).join(' · ');

  return (
    <section className="rounded-2xl border border-slate-200 border-l-4 border-l-amber-400 bg-white dark:border-slate-700 dark:bg-slate-900" aria-label="Thiếu ngày công tác">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
          <CalendarX2 size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-800 dark:text-white">Thiếu ngày công tác</p>
          <p className="text-xs text-slate-500" title="Biểu đồ biến động nhân sự chưa xếp được những người này vào tháng nào">{summary}</p>
        </div>
        {open ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          {groups.map(group => (
            <div key={group.key}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{group.title} · <span className="tabular-nums">{group.people.length}</span></p>
              <div className="max-h-[320px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {group.people.map(person => (
                  <div key={person.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className={ENT}>{person.fullName}</span>
                        {person.employeeCode && <span className="ml-1.5 font-mono text-[11px] text-slate-400">{person.employeeCode}</span>}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {group.key === 'exit'
                          ? (person.startDate ? `Vào làm ${viDate(person.startDate)}` : 'Chưa có ngày vào làm')
                          : person.title || 'Đang làm việc'}
                      </p>
                    </div>
                    <button type="button" className={fixBtn} onClick={() => setEditing({ employee: person, kind: group.key })}>
                      {group.action}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EmploymentDateDialog employee={editing.employee} kind={editing.kind} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </section>
  );
};

export default HrmEmploymentDateGapsPanel;
