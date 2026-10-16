import React, { useMemo, useState } from 'react';
import { ChevronRight, Clock3, PencilLine } from 'lucide-react';
import {
  FIELD_BY_KEY, ROSTER_FIELDS, ROSTER_GROUPS, formatValue, isPayField, isPlaceholderPhone, missingFields, moneyVi, positionOf, salaryTotal, seniorityLabel, seniorityMonths,
  type RosterData, type RosterFieldKey, type RosterGroupKey, type RosterRow, type RosterValue,
} from '../../../lib/hrmRoster';
import { DRAFT_CELL, ENT, MISSING_CHIP, NUM, PENDING_CELL } from './rosterUi';

export type RosterDraftMap = Map<string, Partial<Record<string, RosterValue>>>;

interface Column {
  key: string;
  label: string;
  group: RosterGroupKey;
  width: number;
  align?: 'right';
  field?: RosterFieldKey;
  render?: (row: RosterRow, values: RosterRow['values']) => React.ReactNode;
}

const UNGROUPED = '__none__';

/** Columns shown for the chosen groups, with the derived ones (nhóm, thâm niên, tổng lương) in place. */
export const rosterColumns = (data: RosterData, groups: RosterGroupKey[]): Column[] => {
  const columns: Column[] = [];
  const allowed = (group: RosterGroupKey) => groups.includes(group)
    && (group !== 'personal' || data.can.viewPersonal) && (group !== 'pay' || data.can.viewPay);
  ROSTER_GROUPS.forEach(group => {
    if (!allowed(group.key)) return;
    if (group.key === 'pay') {
      columns.push({ key: 'salaryTotal', label: 'Tổng lương', group: 'pay', width: 110, align: 'right',
        render: (_row, values) => { const total = salaryTotal(values); return total == null ? null : <span className={NUM}>{moneyVi(total)}</span>; } });
    }
    // Bộ phận is the row group, so it is not repeated as a column.
    ROSTER_FIELDS.filter(field => field.group === group.key && field.key !== 'orgUnit' && (!field.payOnly || data.can.viewPay)).forEach(field => {
      columns.push({ key: field.key, label: field.label, group: field.group, width: field.width, align: field.align, field: field.key });
      if (field.key === 'position') {
        columns.push({ key: 'positionGroup', label: 'Nhóm', group: 'position', width: 64,
          render: (_row, values) => { const p = data.catalogs.positions.find(item => item.id === values.position); return p?.groupCode || null; } });
      }
      if (field.key === 'officialDate') {
        columns.push({ key: 'seniority', label: 'Thâm niên', group: 'contract', width: 84,
          render: (_row, values) => seniorityLabel(seniorityMonths(values.startDate ?? null, data.today)) || null });
      }
    });
    if (group.key === 'pay') {
      columns.push({ key: 'salaryAfter', label: 'Tổng sau thâm niên', group: 'pay', width: 124, align: 'right',
        render: (_row, values) => {
          const total = salaryTotal(values);
          if (total == null) return null;
          const seniority = typeof values.seniorityAllowance === 'number' ? values.seniorityAllowance : 0;
          return <span className={NUM}>{moneyVi(total + seniority)}</span>;
        } });
    }
  });
  return columns;
};

const levelRank = (row: RosterRow) => {
  const level = String(row.values.level || '');
  return /^E\d+$/.test(level) ? Number(level.slice(1)) : -1;
};

interface UnitGroup { key: string; name: string; rows: RosterRow[] }
interface BlockGroup { key: string; name: string; units: UnitGroup[]; count: number }

export const groupRoster = (rows: RosterRow[], data: RosterData): BlockGroup[] => {
  const units = new Map<string, UnitGroup>();
  rows.forEach(row => {
    const unitId = row.values.orgUnit ? String(row.values.orgUnit) : UNGROUPED;
    const unit = data.catalogs.orgUnits.find(item => item.id === unitId);
    if (!units.has(unitId)) units.set(unitId, { key: unitId, name: unit?.name || 'Chưa có bộ phận', rows: [] });
    units.get(unitId)!.rows.push(row);
  });
  units.forEach(unit => unit.rows.sort((a, b) => levelRank(b) - levelRank(a) || a.fullName.localeCompare(b.fullName, 'vi')));
  const order = (id: string) => {
    const index = data.catalogs.orgUnits.findIndex(item => item.id === id);
    const unit = data.catalogs.orgUnits[index];
    return unit?.sortOrder ?? (index < 0 ? 9999 : index);
  };
  const blocks: BlockGroup[] = [...data.catalogs.blocks.map(block => ({ key: block.code, name: block.name })), { key: UNGROUPED, name: 'Chưa xếp khối' }]
    .map(block => {
      const list = [...units.values()].filter(unit => {
        const blockCode = data.catalogs.orgUnits.find(item => item.id === unit.key)?.blockCode || UNGROUPED;
        return blockCode === block.key;
      }).sort((a, b) => order(a.key) - order(b.key));
      return { ...block, units: list, count: list.reduce((sum, unit) => sum + unit.rows.length, 0) };
    })
    .filter(block => block.count > 0);
  return blocks;
};

const cellTitle = (field: string, row: RosterRow, draftValue: RosterValue | undefined, data: RosterData): string | undefined => {
  const pending = row.pending[field as RosterFieldKey];
  const show = (value: RosterValue) => formatValue(field, value, data.catalogs) || 'trống';
  if (draftValue !== undefined) return `Đang soạn: ${show(row.values[field as RosterFieldKey] ?? null)} → ${show(draftValue)}`;
  if (pending) return `Chờ duyệt ${pending.batchCode}: → ${show(pending.value)}`;
  return undefined;
};

export const RosterTable: React.FC<{
  rows: RosterRow[];
  data: RosterData;
  groups: RosterGroupKey[];
  selected: Set<string>;
  draft: RosterDraftMap;
  onSelect: (ids: string[], on: boolean) => void;
  onEditCell: (employeeId: string, field: RosterFieldKey) => void;
  onOpenPerson: (employeeId: string) => void;
}> = ({ rows, data, groups, selected, draft, onSelect, onEditCell, onOpenPerson }) => {
  const columns = useMemo(() => rosterColumns(data, groups), [data, groups]);
  const blocks = useMemo(() => groupRoster(rows, data), [rows, data]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggleUnit = (key: string) => setClosed(cur => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const selectable = data.can.edit;
  const left = selectable ? [0, 40, 136] : [0, 0, 96];
  const fixedWidth = (selectable ? 40 : 0) + 96 + 200;
  const tableWidth = fixedWidth + columns.reduce((sum, column) => sum + column.width, 0);
  const groupSpans = ROSTER_GROUPS.map(group => ({ ...group, span: columns.filter(column => column.group === group.key).length })).filter(group => group.span > 0);
  const valuesOf = (row: RosterRow) => ({ ...row.values, ...(draft.get(row.employeeId) || {}) }) as RosterRow['values'];
  let stt = 0;

  const renderCell = (row: RosterRow, column: Column) => {
    const values = valuesOf(row);
    if (column.render) return column.render(row, values) ?? <span className="text-muted-foreground/60">—</span>;
    const key = column.field!;
    const def = FIELD_BY_KEY[key];
    const value = values[key] ?? null;
    const text = formatValue(key, value, data.catalogs);
    if (!text) return def.required ? <span className={MISSING_CHIP}>Thiếu</span> : <span className="text-muted-foreground/60">—</span>;
    if (key === 'phone' && isPlaceholderPhone(value)) return <span className={MISSING_CHIP} title={`${text} là số tạm lúc tạo tài khoản`}>Số tạm</span>;
    if (def.type === 'money' || def.type === 'number') return <span className={NUM}>{text}</span>;
    if (key === 'position') return <span className="font-medium text-foreground">{text}</span>;
    return <span className="text-foreground">{text}</span>;
  };

  return <>
    {/* Desktop / tablet: spreadsheet-like, name columns stay while scrolling sideways. */}
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:block">
      <div className="max-h-[calc(100vh-260px)] min-h-[320px] overflow-auto">
        <table className="table-fixed border-separate border-spacing-0 text-[13px]" style={{ width: tableWidth, minWidth: '100%' }}>
          <colgroup>
            {selectable && <col style={{ width: 40 }} />}
            <col style={{ width: 96 }} /><col style={{ width: 200 }} />
            {columns.map(column => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr className="h-7 text-[11px] font-bold uppercase tracking-wide">
              <th colSpan={selectable ? 3 : 2} className="sticky left-0 top-0 z-30 border-b border-r border-border bg-card px-3 text-left text-muted-foreground">Nhân sự</th>
              {groupSpans.map(group => <th key={group.key} colSpan={group.span} className={`sticky top-0 z-20 border-b border-r border-border px-3 text-left ${group.tone}`}>{group.label}</th>)}
            </tr>
            <tr className="h-9 text-xs font-semibold text-muted-foreground">
              {selectable && <th className="sticky top-7 z-30 w-10 border-b border-border bg-card" style={{ left: left[0] }}>
                <input type="checkbox" aria-label="Chọn tất cả người đang hiện" className="h-4 w-4 accent-teal-600"
                  checked={rows.length > 0 && rows.every(row => selected.has(row.employeeId))}
                  onChange={e => onSelect(rows.map(row => row.employeeId), e.target.checked)} /></th>}
              <th className="sticky top-7 z-30 border-b border-border bg-card px-2 text-left" style={{ left: left[1], width: 96 }}>Mã NV</th>
              <th className="sticky top-7 z-30 border-b border-r border-border bg-card px-2 text-left" style={{ left: left[2], width: 200 }}>Họ và tên</th>
              {columns.map(column => <th key={column.key} style={{ width: column.width, minWidth: column.width }}
                className={`sticky top-7 z-20 whitespace-nowrap border-b border-border bg-card px-2 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {blocks.map(block => <React.Fragment key={block.key}>
              <tr><td colSpan={columns.length + (selectable ? 3 : 2)} className="border-b border-border bg-slate-800 px-0 py-0 text-white dark:bg-slate-900">
                <div className="sticky left-0 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider">
                  {block.name}<span className="rounded-full bg-white/15 px-2 py-px tabular-nums">{block.count}</span></div></td></tr>
              {block.units.map(unit => {
                const open = !closed.has(`${block.key}:${unit.key}`);
                const ids = unit.rows.map(row => row.employeeId);
                const missing = unit.rows.filter(row => missingFields(row, data.can).length > 0).length;
                const pending = unit.rows.filter(row => Object.keys(row.pending).length > 0).length;
                return <React.Fragment key={unit.key}>
                  <tr className="bg-teal-50/60 dark:bg-teal-950/20">
                    <td colSpan={columns.length + (selectable ? 3 : 2)} className="border-b border-l-4 border-border border-l-teal-500 p-0">
                      <div className="sticky left-0 flex w-max items-center">
                        {selectable && <label className="flex w-10 cursor-pointer items-center justify-center self-stretch">
                          <input type="checkbox" aria-label={`Chọn cả ${unit.name}`} className="h-4 w-4 accent-teal-600"
                            checked={ids.every(id => selected.has(id))} onChange={e => onSelect(ids, e.target.checked)} /></label>}
                        <button type="button" aria-expanded={open} onClick={() => toggleUnit(`${block.key}:${unit.key}`)}
                          className={`flex items-center gap-2 py-1.5 pr-4 text-left text-sm font-bold text-teal-900 dark:text-teal-100 ${selectable ? '' : 'pl-3'}`}>
                          <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />{unit.name}
                          <span className="rounded-full bg-white/80 px-2 py-px text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">{unit.rows.length}</span>
                          {missing > 0 && <span className="rounded-full bg-amber-100 px-2 py-px text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">{missing} thiếu thông tin</span>}
                          {pending > 0 && <span className="rounded-full bg-indigo-100 px-2 py-px text-xs font-semibold text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">{pending} chờ duyệt</span>}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && unit.rows.map(row => {
                    stt += 1;
                    const isSelected = selected.has(row.employeeId);
                    const rowDraft = draft.get(row.employeeId) || {};
                    const base = isSelected ? 'bg-teal-50 dark:bg-teal-950/30' : 'bg-card group-hover:bg-slate-50 dark:group-hover:bg-slate-800/60';
                    const nameDraft = rowDraft.fullName;
                    return <tr key={row.employeeId} className="group">
                      {selectable && <td className={`sticky z-10 border-b border-border text-center ${base}`} style={{ left: left[0] }}>
                        <input type="checkbox" aria-label={`Chọn ${row.fullName}`} className="h-4 w-4 accent-teal-600" checked={isSelected}
                          onChange={e => onSelect([row.employeeId], e.target.checked)} /></td>}
                      <td className={`sticky z-10 whitespace-nowrap border-b border-border px-2 py-1.5 ${base}`} style={{ left: left[1] }}>
                        <span className="flex items-center gap-1.5"><span className="w-5 text-right text-[11px] tabular-nums text-muted-foreground">{stt}</span>
                          <span className={`text-xs ${ENT}`}>{rowDraft.employeeCode != null ? String(rowDraft.employeeCode) : row.employeeCode}</span></span></td>
                      <td className={`sticky z-10 border-b border-r border-border px-2 py-1.5 ${base}`} style={{ left: left[2] }}>
                        <button type="button" onClick={() => onOpenPerson(row.employeeId)} title={data.can.edit ? 'Mở để sửa thông tin người này' : undefined}
                          className="flex w-full items-center gap-1 truncate text-left font-semibold text-foreground hover:text-teal-700 dark:hover:text-teal-300">
                          <span className="truncate">{nameDraft != null ? String(nameDraft) : row.fullName}</span>
                          {row.status !== 'Đang làm việc' && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{row.status}</span>}
                        </button></td>
                      {columns.map(column => {
                        const field = column.field;
                        const def = field ? FIELD_BY_KEY[field] : null;
                        const draftValue = field ? rowDraft[field] : undefined;
                        const pendingHere = field ? row.pending[field] : undefined;
                        const editable = Boolean(def?.editable && data.can.edit && (!isPayField(def.key) || data.can.editPay));
                        const tone = draftValue !== undefined ? DRAFT_CELL : pendingHere ? PENDING_CELL : '';
                        const content = <span className="flex items-center gap-1 truncate">
                          {pendingHere && draftValue === undefined && <Clock3 size={11} className="shrink-0 text-indigo-500" aria-label="Chờ duyệt" />}
                          <span className={`min-w-0 flex-1 truncate ${column.align === 'right' ? 'text-right' : ''}`}>{renderCell(row, column)}</span>
                        </span>;
                        return <td key={column.key} title={field ? cellTitle(field, row, draftValue, data) : undefined}
                          className={`max-w-0 whitespace-nowrap border-b border-border px-2 py-1.5 ${tone || (isSelected ? 'bg-teal-50/50 dark:bg-teal-950/20' : '')}`}>
                          {editable ? <button type="button" onClick={() => onEditCell(row.employeeId, field!)}
                            className="group/cell flex w-full items-center gap-1 rounded text-left hover:bg-slate-100/80 dark:hover:bg-slate-800">
                            <span className="min-w-0 flex-1">{content}</span>
                            <PencilLine size={11} className="shrink-0 text-muted-foreground opacity-0 group-hover/cell:opacity-100" />
                          </button> : content}
                        </td>;
                      })}
                    </tr>;
                  })}
                </React.Fragment>;
              })}
            </React.Fragment>)}
          </tbody>
        </table>
      </div>
    </div>

    {/* Phone: cards, tap to open the person. */}
    <div className="space-y-3 md:hidden">
      {blocks.map(block => <section key={block.key} className="space-y-2">
        <h3 className="sticky top-0 z-10 flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
          {block.name}<span className="rounded-full bg-white/15 px-2 tabular-nums">{block.count}</span></h3>
        {block.units.map(unit => <div key={unit.key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <p className="border-b border-l-4 border-border border-l-teal-500 bg-teal-50/60 px-3 py-2 text-sm font-bold text-teal-900 dark:bg-teal-950/20 dark:text-teal-100">
            {unit.name} <span className="font-semibold text-muted-foreground">· {unit.rows.length}</span></p>
          <ul className="divide-y divide-border">
            {unit.rows.map(row => {
              const values = valuesOf(row);
              const position = positionOf({ values }, data.catalogs);
              const missing = missingFields({ ...row, values }, data.can);
              const pendingCount = Object.keys(row.pending).length;
              const draftCount = Object.keys(draft.get(row.employeeId) || {}).length;
              return <li key={row.employeeId} className={`flex items-start gap-3 px-3 py-2.5 ${selected.has(row.employeeId) ? 'bg-teal-50 dark:bg-teal-950/30' : ''}`}>
                {selectable && <input type="checkbox" aria-label={`Chọn ${row.fullName}`} className="mt-1 h-5 w-5 shrink-0 accent-teal-600"
                  checked={selected.has(row.employeeId)} onChange={e => onSelect([row.employeeId], e.target.checked)} />}
                <button type="button" onClick={() => onOpenPerson(row.employeeId)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-foreground">{row.fullName}</span>
                    <span className={`shrink-0 text-xs ${ENT}`}>{row.employeeCode}</span></span>
                  <span className="block truncate text-sm text-muted-foreground">{position?.name || 'Chưa có chức danh'}{values.level ? ` · ${values.level}` : ''}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {values.startDate && <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-semibold text-muted-foreground">{seniorityLabel(seniorityMonths(values.startDate, data.today))}</span>}
                    {missing.length > 0 && <span className={MISSING_CHIP}>Thiếu {missing.length}</span>}
                    {pendingCount > 0 && <span className="rounded-md bg-indigo-50 px-1.5 py-px text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">Chờ duyệt {pendingCount}</span>}
                    {draftCount > 0 && <span className="rounded-md bg-sky-50 px-1.5 py-px text-[11px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">Đang soạn {draftCount}</span>}
                  </span>
                </button>
              </li>;
            })}
          </ul>
        </div>)}
      </section>)}
    </div>
  </>;
};
