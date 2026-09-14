import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import type { UsableRequestTemplate } from '../../lib/requestRuntimeService';
import UserSearchSelect from '../common/UserSearchSelect';

const controlClass = 'w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100/70 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-emerald-950';

export const RequestFieldInput: React.FC<{
  field: UsableRequestTemplate['formSchema'][number];
  value: unknown;
  onChange: (value: unknown) => void;
  users: User[];
  disabled?: boolean;
}> = ({ field, value, onChange, users, disabled }) => {
  const stringValue = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (field.fieldType === 'textarea') return <textarea rows={4} value={stringValue} onChange={event => onChange(event.target.value)} className={controlClass} disabled={disabled} />;
  if (field.fieldType === 'select') return <select value={stringValue} onChange={event => onChange(event.target.value)} className={controlClass} disabled={disabled}><option value="">Chọn {field.label}</option>{field.options.map(option => <option key={option}>{option}</option>)}</select>;
  if (field.fieldType === 'date') return <input type="date" value={stringValue} onChange={event => onChange(event.target.value)} className={controlClass} disabled={disabled} />;
  if (field.fieldType === 'number') return <input type="number" value={stringValue} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} className={controlClass} disabled={disabled} />;
  if (field.fieldType === 'user') return <UserSearchSelect users={users} value={stringValue} onChange={id => onChange(id || '')} placeholder="Gõ tên hoặc vị trí để tìm..." disabled={disabled} />;
  if (field.fieldType === 'file') return <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Tệp của biểu mẫu chưa thuộc phạm vi đợt này. Anh/chị có thể đính kèm tệp trong phần Thảo luận.</p>;
  if (field.fieldType !== 'table') return <input value={stringValue} onChange={event => onChange(event.target.value)} className={controlClass} disabled={disabled} />;

  const columns = field.options.filter(Boolean).length ? field.options.filter(Boolean) : ['Nội dung', 'Số lượng', 'Ghi chú'];
  const emptyRow = () => Object.fromEntries(columns.map(column => [column, '']));
  const rows = Array.isArray(value) && value.length ? value as Array<Record<string, string>> : [emptyRow()];
  const updateCell = (rowIndex: number, column: string, nextValue: string) => onChange(rows.map((row, index) => index === rowIndex ? { ...row, [column]: nextValue } : row));
  const removeRow = (rowIndex: number) => { const next = rows.filter((_, index) => index !== rowIndex); onChange(next.length ? next : [emptyRow()]); };

  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/40">
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full table-fixed text-left text-xs">
        <thead className="border-b border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"><tr><th className="w-10 px-2 py-2.5 text-center">#</th>{columns.map(column => <th key={column} className="px-2 py-2.5 font-semibold normal-case break-words">{column}</th>)}<th className="w-10" /></tr></thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">{rows.map((row, rowIndex) => <tr key={rowIndex}><td className="px-2 text-center text-slate-400">{rowIndex + 1}</td>{columns.map(column => <td key={column} className="p-1.5"><input value={row[column] ?? ''} onChange={event => updateCell(rowIndex, column, event.target.value)} className={`${controlClass} px-2.5 py-2 text-xs`} disabled={disabled} /></td>)}<td><button type="button" onClick={() => removeRow(rowIndex)} disabled={disabled || rows.length === 1} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" aria-label={`Xóa dòng ${rowIndex + 1}`}><Trash2 size={14} /></button></td></tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-3 p-3 md:hidden">{rows.map((row, rowIndex) => <fieldset key={rowIndex} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><legend className="px-1 text-xs font-bold text-emerald-700">Dòng {rowIndex + 1}</legend><div className="space-y-3">{columns.map(column => <label key={column} className="block"><span className="mb-1 block break-words text-xs font-medium text-slate-600 dark:text-slate-300">{column}</span><input value={row[column] ?? ''} onChange={event => updateCell(rowIndex, column, event.target.value)} className={controlClass} disabled={disabled} /></label>)}</div><button type="button" onClick={() => removeRow(rowIndex)} disabled={disabled || rows.length === 1} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 disabled:opacity-30"><Trash2 size={14} /> Xóa dòng</button></fieldset>)}</div>
    <div className="border-t border-slate-200 p-2.5 dark:border-slate-700"><button type="button" onClick={() => onChange([...rows, emptyRow()])} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"><Plus size={14} /> Thêm dòng</button></div>
  </div>;
};

export const RequestFormFields: React.FC<{
  fields: UsableRequestTemplate['formSchema'];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  users: User[];
  disabled?: boolean;
}> = ({ fields, values, onChange, users, disabled }) => <div className="space-y-5">
  {[...fields].sort((a, b) => a.sortOrder - b.sortOrder).map(field => <div key={field.key} className="grid min-w-0 gap-2 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-7">
    <label className="text-sm font-semibold leading-5 text-slate-700 dark:text-slate-200" htmlFor={`request-field-${field.key}`}>{field.label}{field.required && <span className="ml-1 text-rose-500">*</span>}</label>
    <div id={`request-field-${field.key}`} className="min-w-0"><RequestFieldInput field={field} value={values[field.key]} onChange={value => onChange({ ...values, [field.key]: value })} users={users} disabled={disabled} /></div>
  </div>)}
</div>;
