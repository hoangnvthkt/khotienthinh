import React, { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, ListPlus, Plus, Trash2 } from 'lucide-react';
import type { RequestFieldType } from '../../../types';
import { createFieldKey, type RequestTemplateDraft, type RequestTemplateDraftAction, type RequestTemplateValidationIssue } from '../../../lib/requestTemplateEditorModel';

interface Props {
  fields: RequestTemplateDraft['fields'];
  dispatch: (action: RequestTemplateDraftAction) => void;
  issues: RequestTemplateValidationIssue[];
}

const fieldTypes: Array<{ value: RequestFieldType; label: string }> = [
  { value: 'text', label: 'Văn bản ngắn' }, { value: 'textarea', label: 'Văn bản dài' },
  { value: 'number', label: 'Số' }, { value: 'date', label: 'Ngày tháng' },
  { value: 'select', label: 'Danh sách chọn' }, { value: 'table', label: 'Dữ liệu dạng bảng (table)' },
  { value: 'user', label: 'Người dùng' }, { value: 'file', label: 'Tệp đính kèm' },
];

const RequestFormBuilder: React.FC<Props> = ({ fields, dispatch, issues }) => {
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<RequestFieldType>('text');
  const firstNewFieldRef = useRef<HTMLInputElement | null>(null);
  const formIssues = issues.filter(issue => issue.section === 'FORM');
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    const field = { key: createFieldKey(label, fields.map(item => item.key)), label, fieldType: newType, required: false, options: (newType === 'select' || newType === 'table') ? [''] : [], sortOrder: fields.length + 1 };
    dispatch({ type: 'UPSERT_FIELD', field });
    setNewLabel('');
    setNewType('text');
    window.setTimeout(() => firstNewFieldRef.current?.focus(), 0);
  };
  const update = (index: number, patch: Partial<RequestTemplateDraft['fields'][number]>) => {
    const existing = fields[index];
    const fieldType = patch.fieldType ?? existing.fieldType;
    dispatch({ type: 'UPSERT_FIELD', field: { ...existing, ...patch, options: (fieldType === 'select' || fieldType === 'table') ? (patch.options ?? existing.options) : [] } });
  };
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return;
    const keys = [...fields.map(field => field.key)];
    [keys[from], keys[to]] = [keys[to], keys[from]];
    dispatch({ type: 'REORDER_FIELDS', orderedKeys: keys });
  };
  const remove = (key: string) => {
    if (window.confirm('Xóa trường này khỏi mẫu yêu cầu?')) dispatch({ type: 'REMOVE_FIELD', key });
  };
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-bold text-slate-800 dark:text-white">Mẫu form đề xuất</h2><p className="mt-1 text-sm text-slate-500">Thêm các trường người tạo cần điền khi gửi đề xuất.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500 dark:bg-slate-800">{fields.length} trường</span></header><div className="space-y-4 p-5"><div className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70 md:grid-cols-[minmax(0,1fr)_12rem_auto]"><input value={newLabel} onChange={event => setNewLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} placeholder="Tên trường, ví dụ: Lý do đề xuất" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-900" /><select value={newType} onChange={event => setNewType(event.target.value as RequestFieldType)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-900">{fieldTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><button type="button" onClick={add} className="inline-flex items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white hover:bg-emerald-600"><Plus size={16} className="mr-1" /> Thêm trường</button></div>{fields.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-400 dark:border-slate-700"><ListPlus className="mx-auto mb-2" size={28} />Chưa có trường dữ liệu.</div> : <div className="space-y-3">{fields.map((field, index) => <article key={field.key} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex items-start gap-3"><GripVertical className="mt-2 text-slate-300" size={18} /><div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]"><label><span className="mb-1 block text-xs font-bold text-slate-500">Nhãn trường</span><input ref={index === fields.length - 1 ? firstNewFieldRef : undefined} value={field.label} onChange={event => update(index, { label: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800" /></label><label><span className="mb-1 block text-xs font-bold text-slate-500">Kiểu dữ liệu</span><select value={field.fieldType} onChange={event => update(index, { fieldType: event.target.value as RequestFieldType })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800">{fieldTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="mt-6 flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300"><input type="checkbox" checked={field.required} onChange={event => update(index, { required: event.target.checked })} className="h-4 w-4 accent-emerald-600" />Bắt buộc</label></div><div className="flex gap-1"><button type="button" aria-label="Di chuyển trường lên" disabled={index === 0} onClick={() => reorder(index, index - 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronUp size={16} /></button><button type="button" aria-label="Di chuyển trường xuống" disabled={index === fields.length - 1} onClick={() => reorder(index, index + 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronDown size={16} /></button><button type="button" aria-label="Xóa trường" onClick={() => remove(field.key)} className="rounded-lg p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={16} /></button></div></div>{field.fieldType === 'select' && <label className="mt-3 block pl-8"><span className="mb-1 block text-xs font-bold text-slate-500">Các lựa chọn, mỗi dòng một giá trị</span><textarea value={field.options.join('\n')} onChange={event => update(index, { options: event.target.value.split('\n') })} rows={3} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800" /></label>}{field.fieldType === 'table' && <label className="mt-3 block pl-8"><span className="mb-1 block text-xs font-bold text-slate-500">Các cột của bảng (mỗi dòng một tên cột)</span><textarea value={field.options.join('\n')} onChange={event => update(index, { options: event.target.value.split('\n') })} rows={3} placeholder={"VD:\nTên vật tư / công việc\nĐơn vị tính\nSố lượng\nĐơn giá\nGhi chú"} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800" /></label>}<div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/70">Mã trường: <code>{field.key}</code> · Xem trước: {field.fieldType === 'select' ? 'Danh sách lựa chọn' : field.fieldType === 'table' ? `Bảng dữ liệu (${field.options.filter(Boolean).length} cột)` : field.fieldType === 'textarea' ? 'Ô nhập nhiều dòng' : 'Ô nhập dữ liệu'}</div></article>)}</div>}{formIssues.length > 0 && <ul className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-300">{formIssues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>}</div></section>;
};

export default RequestFormBuilder;
