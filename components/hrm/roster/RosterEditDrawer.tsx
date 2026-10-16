import React, { useMemo, useState } from 'react';
import { Clock3, Users } from 'lucide-react';
import { Drawer, primaryBtn, secondaryBtn, inputCls } from '../../procurement/hub/hubUi';
import {
  FIELD_BY_KEY, ROSTER_FIELDS, ROSTER_GROUPS, codeFromIdNumber, fieldLabel, formatValue, isPayField,
  type RosterData, type RosterFieldKey, type RosterRow, type RosterValue,
} from '../../../lib/hrmRoster';
import type { RosterDraftMap } from './RosterTable';
import { ChangeLine, ENT, ValueInput } from './rosterUi';

export interface RosterDraftChange { employeeId: string; field: RosterFieldKey; value: RosterValue }

const sameValue = (a: RosterValue | undefined, b: RosterValue | undefined) => (a ?? null) === (b ?? null);

/** Đổi thông tin: one person → the whole form; several people → one column at a time. */
export const RosterEditDrawer: React.FC<{
  data: RosterData;
  people: RosterRow[];
  focusField?: RosterFieldKey | null;
  draft: RosterDraftMap;
  onClose: () => void;
  onApply: (changes: RosterDraftChange[]) => void;
}> = ({ data, people, focusField, draft, onClose, onApply }) => {
  const single = people.length === 1 ? people[0] : null;
  const editableFields = useMemo(() => ROSTER_FIELDS.filter(field => field.editable
    && (field.group !== 'personal' || data.can.viewPersonal)
    && (!isPayField(field.key) || data.can.editPay)), [data.can]);
  const current = (row: RosterRow, field: RosterFieldKey): RosterValue => {
    const drafted = draft.get(row.employeeId)?.[field];
    return drafted !== undefined ? drafted : row.values[field] ?? null;
  };

  // --- one person: full form ---------------------------------------------------
  const [form, setForm] = useState<Partial<Record<RosterFieldKey, RosterValue>>>(() => single
    ? Object.fromEntries(editableFields.map(field => [field.key, current(single, field.key)])) : {});
  const changedSingle = single ? editableFields.filter(field => !sameValue(form[field.key], current(single, field.key))) : [];

  // --- many people: one field --------------------------------------------------
  const [bulkField, setBulkField] = useState<RosterFieldKey>(focusField && editableFields.some(f => f.key === focusField) ? focusField : 'position');
  const [bulkValue, setBulkValue] = useState<RosterValue>(null);
  const [withLevel, setWithLevel] = useState(false);
  const bulkDef = FIELD_BY_KEY[bulkField];
  const chosenPosition = bulkField === 'position' ? data.catalogs.positions.find(p => p.id === bulkValue) : null;
  const bulkRows = people.map(row => ({ row, old: current(row, bulkField), pending: row.pending[bulkField] }));
  const bulkTargets = bulkRows.filter(item => !item.pending && bulkValue != null && !sameValue(item.old, bulkValue));

  const applySingle = () => {
    if (!single) return;
    const changes = editableFields
      .filter(field => !sameValue(form[field.key], current(single, field.key)))
      .map(field => ({ employeeId: single.employeeId, field: field.key, value: form[field.key] ?? null }));
    onApply(changes);
  };
  const applyBulk = () => {
    const changes: RosterDraftChange[] = bulkTargets.map(item => ({ employeeId: item.row.employeeId, field: bulkField, value: bulkValue }));
    if (withLevel && chosenPosition?.levelCode) {
      people.filter(row => !row.pending.level && !sameValue(current(row, 'level'), chosenPosition.levelCode))
        .forEach(row => changes.push({ employeeId: row.employeeId, field: 'level', value: chosenPosition.levelCode }));
    }
    onApply(changes);
  };

  const header = single
    ? <><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Đổi thông tin</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{single.fullName} <span className={`text-sm ${ENT}`}>{single.employeeCode}</span></h2></>
    : <><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Đổi thông tin</p>
      <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-foreground"><Users size={18} className="text-teal-600" />{people.length} người đã chọn</h2></>;

  if (single) {
    const position = data.catalogs.positions.find(p => p.id === form.position);
    const newCode = codeFromIdNumber(form.idNumber ?? null);
    return <Drawer label={`Đổi thông tin ${single.fullName}`} onClose={onClose} header={header}
      footer={<>
        <span className="mr-auto text-sm text-muted-foreground">{changedSingle.length ? `${changedSingle.length} ô thay đổi` : 'Chưa đổi ô nào'}</span>
        <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
        <button type="button" disabled={changedSingle.length === 0} onClick={applySingle} className={primaryBtn}>Thêm vào phiếu</button>
      </>}>
      {ROSTER_GROUPS.map(group => {
        const fields = editableFields.filter(field => field.group === group.key);
        if (fields.length === 0) return null;
        return <section key={group.key} className="rounded-2xl border border-border bg-card">
          <h3 className={`rounded-t-2xl px-4 py-2 text-xs font-bold uppercase tracking-wide ${group.tone}`}>{group.label}</h3>
          <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2">
            {fields.map(field => {
              const pending = single.pending[field.key];
              const changed = !sameValue(form[field.key], single.values[field.key]);
              return <label key={field.key} className={`block min-w-0 ${field.key === 'permanentAddress' || field.key === 'note' ? 'sm:col-span-2' : ''}`}>
                <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                  <span>{field.label}{field.required && <span className="text-amber-600"> *</span>}</span>
                  {changed && !pending && <span className="text-sky-700 dark:text-sky-300">đã đổi</span>}
                </span>
                {pending
                  ? <span className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
                    <Clock3 size={13} />Chờ duyệt {pending.batchCode}: {formatValue(field.key, pending.value, data.catalogs) || 'trống'}</span>
                  : <ValueInput field={field} value={form[field.key] ?? null} catalogs={data.catalogs} autoFocus={focusField === field.key}
                    onChange={value => setForm(cur => ({ ...cur, [field.key]: value }))} />}
                {field.key === 'level' && position?.levelCode && form.level !== position.levelCode && !pending && <button type="button"
                  onClick={() => setForm(cur => ({ ...cur, level: position.levelCode }))} className="mt-1 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">
                  Dùng level chuẩn của chức danh: {position.levelCode}</button>}
                {field.key === 'idNumber' && newCode && newCode !== single.employeeCode && <span className="mt-1 block text-xs text-muted-foreground">Mã NV mới: <b className={ENT}>{newCode}</b> (cũ {single.employeeCode})</span>}
              </label>;
            })}
          </div>
        </section>;
      })}
    </Drawer>;
  }

  return <Drawer label="Đổi thông tin nhiều người" onClose={onClose} header={header}
    footer={<>
      <span className="mr-auto text-sm text-muted-foreground">{bulkValue == null ? 'Chọn giá trị mới' : `${bulkTargets.length}/${people.length} người sẽ đổi`}</span>
      <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
      <button type="button" disabled={bulkTargets.length === 0 && !(withLevel && chosenPosition)} onClick={applyBulk} className={primaryBtn}>Thêm vào phiếu</button>
    </>}>
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Thông tin cần đổi</span>
        <select value={bulkField} onChange={e => { setBulkField(e.target.value as RosterFieldKey); setBulkValue(null); setWithLevel(false); }} className={`w-full ${inputCls}`}>
          {ROSTER_GROUPS.map(group => {
            const fields = editableFields.filter(field => field.group === group.key);
            return fields.length ? <optgroup key={group.key} label={group.label}>
              {fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</optgroup> : null;
          })}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Giá trị mới</span>
        <ValueInput key={bulkField} field={bulkDef} value={bulkValue} catalogs={data.catalogs} onChange={setBulkValue} />
      </label>
      {chosenPosition?.levelCode && <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={withLevel} onChange={e => setWithLevel(e.target.checked)} className="h-4 w-4 accent-teal-600" />
        Đổi luôn level về level chuẩn của chức danh <b>{chosenPosition.levelCode}</b></label>}
    </section>
    <section className="rounded-2xl border border-border bg-card">
      <h3 className="border-b border-border px-4 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Xem trước · {fieldLabel(bulkField)}</h3>
      <ul className="divide-y divide-border px-4">
        {bulkRows.map(item => <li key={item.row.employeeId} className="py-1.5">
          <p className="text-sm font-semibold text-foreground">{item.row.fullName} <span className={`text-xs ${ENT}`}>{item.row.employeeCode}</span></p>
          {item.pending
            ? <p className="flex items-center gap-1 text-xs text-indigo-700 dark:text-indigo-300"><Clock3 size={12} />Đang chờ duyệt ở {item.pending.batchCode} — bỏ qua người này</p>
            : bulkValue == null ? <p className="text-xs text-muted-foreground">Hiện tại: {formatValue(bulkField, item.old, data.catalogs) || 'trống'}</p>
              : sameValue(item.old, bulkValue) ? <p className="text-xs text-muted-foreground">Đã đúng giá trị này — không đổi</p>
                : <ul><ChangeLine field={bulkField} oldValue={item.old} newValue={bulkValue} catalogs={data.catalogs} /></ul>}
        </li>)}
      </ul>
    </section>
  </Drawer>;
};
