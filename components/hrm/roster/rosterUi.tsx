import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import SearchableSelect from '../../common/SearchableSelect';
import { inputCls } from '../../procurement/hub/hubUi';
import {
  GENDER_OPTIONS, fieldDef, fieldLabel, formatValue,
  type RosterBatchStatus, type RosterCatalogs, type RosterFieldDef, type RosterValue,
} from '../../../lib/hrmRoster';

// Shared look of Bảng nhân sự: theme mint/leaf like Mua hàng, amber = thiếu, indigo = chờ duyệt, sky = đang soạn.
export const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
export const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';

export const MISSING_CHIP = 'inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-px text-[11px] font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
export const PENDING_CELL = 'bg-indigo-50/80 dark:bg-indigo-950/30';
export const DRAFT_CELL = 'bg-sky-50 outline outline-1 -outline-offset-2 outline-dashed outline-sky-400 dark:bg-sky-950/30';

export const BATCH_STATUS_STYLE: Record<RosterBatchStatus, string> = {
  pending: 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200',
  returned: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  approved: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
export const BATCH_STRIP: Record<RosterBatchStatus, string> = {
  pending: 'border-l-indigo-400', returned: 'border-l-rose-400', approved: 'border-l-leaf-500', cancelled: 'border-l-slate-300',
};

/** Value of one cell as text, styled by type (money/number right-aligned green, ids mint). */
export const ValueText: React.FC<{ field: string; value: RosterValue; catalogs: RosterCatalogs; className?: string }> = ({ field, value, catalogs, className = '' }) => {
  const text = formatValue(field, value, catalogs);
  if (!text) return <span className={`text-muted-foreground ${className}`}>trống</span>;
  const def = fieldDef(field);
  const tone = def && (def.type === 'money' || def.type === 'number') ? NUM : field === 'employeeCode' ? ENT : 'text-foreground';
  return <span className={`${tone} ${className}`}>{text}</span>;
};

/** "Chức danh: Cố vấn → Trưởng phòng TKĐT" */
export const ChangeLine: React.FC<{ field: string; oldValue: RosterValue; newValue: RosterValue; catalogs: RosterCatalogs; onRemove?: () => void }> = ({ field, oldValue, newValue, catalogs, onRemove }) =>
  <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-sm">
    <span className="w-36 shrink-0 text-xs font-semibold text-muted-foreground">{fieldLabel(field)}</span>
    <ValueText field={field} value={oldValue} catalogs={catalogs} className={oldValue == null || oldValue === '' ? 'italic' : 'line-through decoration-slate-400/70 opacity-70'} />
    <ArrowRight size={13} className="shrink-0 text-muted-foreground" />
    <ValueText field={field} value={newValue} catalogs={catalogs} className="font-semibold" />
    {onRemove && <button type="button" onClick={onRemove} className="ml-auto rounded px-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-rose-700">Bỏ</button>}
  </li>;

export const parseNumberInput = (text: string): number | null => {
  const clean = text.trim().replace(/\s/g, '');
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/\.(?=\d{3}(\D|$))/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

/** Input matching the column type; select columns read from the catalogs. */
export const ValueInput: React.FC<{
  field: RosterFieldDef; value: RosterValue; catalogs: RosterCatalogs; onChange: (value: RosterValue) => void; autoFocus?: boolean; id?: string;
}> = ({ field, value, catalogs, onChange, autoFocus, id }) => {
  const [text, setText] = useState(() => (field.type === 'money' || field.type === 'number') && typeof value === 'number' ? formatValue(field.key, value, catalogs) : '');
  useEffect(() => {
    if (field.type === 'money' || field.type === 'number') setText(typeof value === 'number' ? formatValue(field.key, value, catalogs) : '');
  }, [field.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (field.catalog === 'orgUnit') {
    return <SearchableSelect ariaLabel={field.label} value={value == null ? null : String(value)} options={catalogs.orgUnits}
      getOptionValue={unit => unit.id} getOptionLabel={unit => unit.name} getOptionSearchText={unit => `${unit.code || ''} ${unit.name}`}
      renderOption={unit => <span className="flex items-center justify-between gap-2"><span>{unit.name}</span><span className="text-xs text-muted-foreground">{unit.blockCode}</span></span>}
      placeholder="Chọn bộ phận…" onChange={unit => onChange(unit?.id ?? null)} />;
  }
  if (field.catalog === 'position') {
    return <SearchableSelect ariaLabel={field.label} value={value == null ? null : String(value)} options={catalogs.positions}
      getOptionValue={position => position.id} getOptionLabel={position => position.name}
      getOptionSearchText={position => `${position.code || ''} ${position.name} ${position.groupCode || ''}`}
      renderOption={position => <span className="flex items-center justify-between gap-2"><span>{position.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{[position.groupCode, position.levelCode].filter(Boolean).join(' · ')}</span></span>}
      placeholder="Chọn chức danh…" onChange={position => onChange(position?.id ?? null)} />;
  }
  if (field.type === 'select' && field.options) {
    return <select id={id} aria-label={field.label} autoFocus={autoFocus} value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value || null)} className={`w-full ${inputCls}`}>
      <option value="">— Chọn —</option>
      {field.options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>;
  }
  if (field.type === 'select') {
    const options = field.catalog === 'level' ? catalogs.levels.map(level => ({ code: level.code, name: `${level.code} — ${level.name}` }))
      : field.catalog === 'education' ? catalogs.education : GENDER_OPTIONS;
    return <select id={id} aria-label={field.label} autoFocus={autoFocus} value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value || null)} className={`w-full ${inputCls}`}>
      <option value="">— Chọn —</option>
      {options.map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
    </select>;
  }
  if (field.type === 'date') {
    return <input id={id} type="date" aria-label={field.label} autoFocus={autoFocus} value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value || null)} className={`w-full ${inputCls}`} />;
  }
  if (field.type === 'money' || field.type === 'number') {
    return <input id={id} inputMode="decimal" aria-label={field.label} autoFocus={autoFocus} value={text} placeholder={field.type === 'money' ? 'VD 5.000.000' : 'VD 12'}
      onChange={e => { setText(e.target.value); onChange(parseNumberInput(e.target.value)); }}
      onBlur={() => setText(typeof value === 'number' ? formatValue(field.key, value, catalogs) : text)}
      className={`w-full text-right tabular-nums ${inputCls}`} />;
  }
  return <input id={id} aria-label={field.label} autoFocus={autoFocus} value={typeof value === 'string' ? value : value == null ? '' : String(value)}
    onChange={e => onChange(e.target.value.trim() === '' ? null : e.target.value)} className={`w-full ${inputCls}`} />;
};

/** localStorage-backed state for per-viewer conveniences; works when storage is blocked. */
export const useStoredState = <T,>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [value, setValue] = useState<T>(() => {
    try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : initial; } catch { return initial; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep in memory */ }
  }, [key, value]);
  return [value, setValue];
};
