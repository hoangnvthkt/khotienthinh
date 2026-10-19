// Harness Ngày nghỉ việc (19/10): dải "Thiếu ngày công tác", form Sửa hồ sơ, nút Cho nghỉ việc — component thật.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import type { Employee } from '../../types';
import { useApp, replaceEmployeeLocal } from './app-context-stub';
import EmployeeModal from '../../components/hrm/EmployeeModal';
import EmploymentDateDialog from '../../components/hrm/EmploymentDateDialog';
import HrmEmploymentDateGapsPanel from '../../components/hrm/HrmEmploymentDateGapsPanel';

const Harness: React.FC = () => {
  const { employees } = useApp();
  const [editing, setEditing] = useState<Employee | null>(null);
  const [exiting, setExiting] = useState<Employee | null>(null);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <HrmEmploymentDateGapsPanel employees={employees} onSaved={replaceEmployeeLocal} />
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {employees.map(emp => (
          <li key={emp.id} data-testid={`row-${emp.id}`} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{emp.fullName} <span className="font-mono text-xs text-slate-400">{emp.employeeCode}</span></p>
              <p className="text-xs text-slate-500" data-testid={`status-${emp.id}`}>
                {emp.status}{emp.status === 'Đã nghỉ việc' ? (emp.exitDate ? ` từ ${emp.exitDate.split('-').reverse().join('/')}` : ' · chưa ghi ngày') : ''}
                {emp.startDate ? ` · vào ${emp.startDate.split('-').reverse().join('/')}` : ''}
              </p>
            </div>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setEditing(emp)}>Sửa {emp.employeeCode}</button>
            {emp.status === 'Đang làm việc' && (
              <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setExiting(emp)}>Cho nghỉ {emp.employeeCode}</button>
            )}
          </li>
        ))}
      </ul>
      {editing && <EmployeeModal employee={editing} onClose={() => setEditing(null)} />}
      {exiting && <EmploymentDateDialog employee={exiting} kind="exit" onClose={() => setExiting(null)} onSaved={replaceEmployeeLocal} />}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<ToastProvider><Harness /></ToastProvider>);
