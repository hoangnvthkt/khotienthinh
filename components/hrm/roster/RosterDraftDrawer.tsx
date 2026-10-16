import React, { useMemo, useState } from 'react';
import { Send, Trash2, UserCheck } from 'lucide-react';
import { Drawer, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { fieldLabel, type RosterData, type RosterFieldKey, type RosterRow, type RosterValue } from '../../../lib/hrmRoster';
import type { RosterDraftMap } from './RosterTable';
import { ChangeLine, ENT } from './rosterUi';

export const draftTitle = (draft: RosterDraftMap): string => {
  const fields = new Set<string>();
  draft.forEach(changes => Object.keys(changes).forEach(field => fields.add(field)));
  const names = [...fields].map(fieldLabel);
  const head = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  return `Đổi ${head.toLowerCase()} · ${draft.size} người`;
};

/** Phiếu nháp: what HR changed on the table, sent as one request to the approver. */
export const RosterDraftDrawer: React.FC<{
  data: RosterData;
  rows: RosterRow[];
  draft: RosterDraftMap;
  onClose: () => void;
  onRemove: (employeeId: string, field: RosterFieldKey) => void;
  onClear: () => void;
  onSubmit: (input: { reason: string; effectiveDate: string }) => Promise<void>;
}> = ({ data, rows, draft, onClose, onRemove, onClear, onSubmit }) => {
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(data.today);
  const [saving, setSaving] = useState(false);
  const people = useMemo(() => [...draft.entries()]
    .map(([employeeId, changes]) => ({ row: rows.find(row => row.employeeId === employeeId), changes }))
    .filter((item): item is { row: RosterRow; changes: Partial<Record<string, RosterValue>> } => Boolean(item.row))
    .sort((a, b) => a.row.fullName.localeCompare(b.row.fullName, 'vi')), [draft, rows]);
  const count = people.reduce((sum, item) => sum + Object.keys(item.changes).length, 0);
  const reasonOk = reason.trim().length >= 10;
  const submit = async () => {
    setSaving(true);
    try { await onSubmit({ reason: reason.trim(), effectiveDate }); } finally { setSaving(false); }
  };

  return <Drawer label="Phiếu thay đổi nháp" onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phiếu nháp</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{draftTitle(draft)}</h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><UserCheck size={14} className="text-teal-600" />
        Người duyệt: <b className="text-foreground">{data.approvers.map(item => item.name).join(', ') || 'chưa có'}</b></p>
    </>}
    footer={<>
      <button type="button" onClick={onClear} disabled={saving} className={`${secondaryBtn} mr-auto text-rose-700`}><Trash2 size={15} />Bỏ phiếu nháp</button>
      <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
      <button type="button" onClick={() => void submit()} disabled={!reasonOk || count === 0 || saving || data.approvers.length === 0}
        title={!reasonOk ? 'Ghi lý do ít nhất 10 ký tự' : undefined} className={primaryBtn}><Send size={15} />Gửi duyệt {count} thay đổi</button>
    </>}>
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[180px_1fr]">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Hiệu lực từ</span>
        <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value || data.today)} className={`w-full ${inputCls}`} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Lý do <span className="text-amber-600">*</span></span>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="VD: Điều chuyển theo QĐ 12/2026 của TGĐ"
          className={`w-full resize-y ${inputCls}`} />
      </label>
    </section>
    <section className="rounded-2xl border border-border bg-card">
      <h3 className="border-b border-border px-4 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{count} thay đổi · {people.length} người</h3>
      <ul className="divide-y divide-border">
        {people.map(({ row, changes }) => <li key={row.employeeId} className="px-4 py-2">
          <p className="text-sm font-semibold text-foreground">{row.fullName} <span className={`text-xs ${ENT}`}>{row.employeeCode}</span></p>
          <ul>{Object.entries(changes).map(([field, value]) => <ChangeLine key={field} field={field} oldValue={row.values[field as RosterFieldKey] ?? null}
            newValue={value ?? null} catalogs={data.catalogs} onRemove={() => onRemove(row.employeeId, field as RosterFieldKey)} />)}</ul>
        </li>)}
      </ul>
    </section>
  </Drawer>;
};
