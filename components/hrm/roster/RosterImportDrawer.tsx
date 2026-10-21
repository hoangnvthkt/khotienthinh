import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Send, UserPlus, UserX } from 'lucide-react';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import {
  MATCH_LABEL, dateVi, fieldLabel, importItemsFor, matchRosterImport, monthStartOf, readRosterWorkbook, resolveImportValues,
  type RosterChangeItem, type RosterData, type RosterImportMatch, type RosterImportPlan, type RosterRow,
} from '../../../lib/hrmRoster';
import { BatchItems } from './RosterBatches';
import { ENT, NUM } from './rosterUi';

type Tab = 'confirm' | 'new' | 'changes' | 'missing' | 'notes';
type Choice = string; // employee id, 'new' or 'skip'

const personLabel = (row: RosterRow, data: RosterData) => {
  const unit = data.catalogs.orgUnits.find(item => item.id === row.values.orgUnit)?.name;
  const position = data.catalogs.positions.find(item => item.id === row.values.position)?.name;
  return [row.employeeCode, row.fullName, position || unit, row.hint].filter(Boolean).join(' · ');
};

/** Nhập Data: read the standard file, match people, show Cũ → Mới, send one request for approval. */
export const RosterImportDrawer: React.FC<{
  data: RosterData;
  file: File;
  onClose: () => void;
  onSubmit: (input: { title: string; reason: string; effectiveDate: string; items: RosterChangeItem[]; fileName: string }) => Promise<void>;
}> = ({ data, file, onClose, onSubmit }) => {
  const [plan, setPlan] = useState<RosterImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [tab, setTab] = useState<Tab>('confirm');
  const [reason, setReason] = useState('');
  // Pay changes count per month: a file brought in mid-month applies from the 1st.
  const [effectiveDate, setEffectiveDate] = useState(monthStartOf(data.today));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    file.arrayBuffer().then(readRosterWorkbook).then(parsed => {
      if (!alive) return;
      const next = matchRosterImport(parsed, data.rows);
      setSheetName(parsed.sheetName);
      setPlan(next);
      setChoices(Object.fromEntries(next.matches.filter(m => m.how === 'new').map(m => [m.row.rowNumber, m.row.values.startDate ? 'new' : 'skip'])));
      setTab(next.matches.some(m => m.how === 'confirm') ? 'confirm' : 'changes');
      setReason(`Nhập Data nhân sự chuẩn từ file ${file.name}`);
    }).catch(e => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [file, data.rows]);

  const resolved = useMemo<RosterImportMatch[]>(() => (plan?.matches || []).map(match => {
    if (match.how !== 'confirm' && match.how !== 'new') return match;
    const choice = choices[match.row.rowNumber];
    if (!choice || choice === 'skip') return { ...match, employeeId: null, how: match.how };
    if (choice === 'new') return { ...match, employeeId: null, how: 'new' };
    return { ...match, employeeId: choice };
  }), [plan, choices]);

  const included = resolved.filter(match => {
    const choice = choices[match.row.rowNumber];
    if (plan?.matches.find(m => m.row.rowNumber === match.row.rowNumber)?.how === 'confirm' || match.how === 'new') return Boolean(choice) && choice !== 'skip';
    return true;
  });

  const { items, blocked } = useMemo(() => {
    const out: RosterChangeItem[] = [];
    let skippedPending = 0;
    const assigned = new Map<string, string>();
    const taken = (code: string, employeeId: string | null) => data.rows.some(row => row.employeeCode === code && row.employeeId !== employeeId)
      || [...assigned.entries()].some(([key, value]) => value === code && key !== (employeeId || ''));
    included.forEach(match => {
      const person = match.employeeId ? data.rows.find(row => row.employeeId === match.employeeId) || null : null;
      importItemsFor(match, person, data.catalogs, data.can, taken).forEach(item => {
        if (person && person.pending[item.field as keyof RosterRow['pending']]) { skippedPending += 1; return; }
        if (item.field === 'employeeCode' && item.newValue) assigned.set(item.employeeId || item.personKey, String(item.newValue));
        out.push(item);
      });
    });
    return { items: out, blocked: skippedPending };
  }, [included, data]);

  const unresolved = (plan?.matches || []).filter(match => match.how === 'confirm' && !choices[match.row.rowNumber]).length;
  const pickedTwice = (() => {
    const ids = Object.values(choices).filter(choice => choice && choice !== 'new' && choice !== 'skip');
    return ids.filter((id, index) => ids.indexOf(id) !== index).length;
  })();
  const unknownCatalog = useMemo(() => {
    const map = new Map<string, { field: string; text: string; names: string[] }>();
    included.forEach(match => resolveImportValues(match.row, data.catalogs).unknown.forEach(entry => {
      const key = `${entry.field}:${entry.text}`;
      if (!map.has(key)) map.set(key, { field: entry.field, text: entry.text, names: [] });
      map.get(key)!.names.push(match.row.fullName);
    }));
    return [...map.values()];
  }, [included, data.catalogs]);

  const counts = {
    confirm: plan?.matches.filter(m => m.how === 'confirm').length || 0,
    new: plan?.matches.filter(m => m.how === 'new').length || 0,
    changes: new Set(items.map(item => item.personKey)).size,
    missing: plan?.notInFile.length || 0,
    notes: (plan?.issues.length || 0) + unknownCatalog.length,
  };
  const fills = items.filter(item => item.oldValue == null && item.employeeId).length;
  const edits = items.filter(item => item.oldValue != null).length;
  const newPeople = new Set(items.filter(item => !item.employeeId).map(item => item.personKey)).size;
  const canSend = plan && unresolved === 0 && pickedTwice === 0 && items.length > 0 && reason.trim().length >= 10 && data.approvers.length > 0;

  const submit = async () => {
    if (!canSend) return;
    setSaving(true);
    try { await onSubmit({ title: `Nhập Data · ${file.name}`, reason: reason.trim(), effectiveDate, items, fileName: file.name }); } finally { setSaving(false); }
  };

  const tabs: Array<[Tab, string, number, string]> = [
    ['confirm', 'Cần chọn người', counts.confirm, unresolved ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100' : ''],
    ['new', 'Người mới', counts.new, ''],
    ['changes', 'Thay đổi', counts.changes, ''],
    ['missing', 'Không có trong file', counts.missing, ''],
    ['notes', 'Lưu ý', counts.notes, counts.notes ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100' : ''],
  ];

  return <Drawer label="Nhập Data nhân sự" xl onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nhập Data nhân sự</p>
      <h2 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-bold text-foreground"><FileSpreadsheet size={18} className="text-teal-600" />{file.name}
        {sheetName && <span className="text-sm font-medium text-muted-foreground">· sheet {sheetName} · {plan?.matches.length || 0} người</span>}</h2>
      {plan && <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {([[counts.changes - newPeople, 'người cập nhật'], [newPeople, 'người mới'], [fills, 'ô trống được điền'], [edits, 'ô sửa giá trị']] as const)
          .map(([n, label]) => <span key={label} className="rounded-xl border border-border bg-card px-3 py-1.5"><b className={NUM}>{n.toLocaleString('vi-VN')}</b> {label}</span>)}
      </div>}
    </>}
    footer={plan ? <div className="flex w-full flex-wrap items-end gap-2">
      <label className="block w-40"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Hiệu lực từ</span>
        <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value || monthStartOf(data.today))}
          title="Lương và Level vào phân bổ 3P từ ngày này" className={`w-full ${inputCls}`} /></label>
      <label className="block min-w-[14rem] flex-1"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Lý do <span className="text-amber-600">*</span></span>
        <input value={reason} onChange={e => setReason(e.target.value)} className={`w-full ${inputCls}`} /></label>
      <span className="flex items-center gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
        <button type="button" disabled={!canSend || saving} onClick={() => void submit()} className={primaryBtn}
          title={unresolved ? `Còn ${unresolved} dòng chưa chọn người` : pickedTwice ? 'Có người được chọn cho 2 dòng' : undefined}>
          <Send size={15} />Gửi duyệt {items.length.toLocaleString('vi-VN')} thay đổi</button>
      </span>
      {(unresolved > 0 || pickedTwice > 0 || blocked > 0) && <p className="w-full text-xs text-amber-800 dark:text-amber-200">
        {unresolved > 0 && `Còn ${unresolved} dòng cần chọn người. `}{pickedTwice > 0 && 'Có người được chọn cho 2 dòng. '}
        {blocked > 0 && `${blocked} ô đang chờ duyệt ở phiếu khác — bỏ qua lần này.`}</p>}
    </div> : undefined}>
    {error ? <StateBox kind="error" title="Chưa đọc được file" message={error} />
      : !plan ? <StateBox kind="loading" title="Đang đọc file và ghép người…" />
        : <>
          {!data.can.editPay && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Cột lương & phụ cấp không được nhập — chỉ HR Manage nhập.</p>}
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Kết quả ghép">
            {tabs.map(([key, label, n, warn]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${tab === key ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card text-foreground hover:border-teal-300'}`}>
              {label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${tab === key ? 'bg-white/20' : warn || 'bg-muted text-muted-foreground'}`}>{n}</span></button>)}
          </div>

          {tab === 'confirm' && (counts.confirm === 0 ? <StateBox kind="empty" title="Không có dòng nào cần chọn người" />
            : <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {plan.matches.filter(m => m.how === 'confirm').map(match => {
                const choice = choices[match.row.rowNumber] || '';
                return <li key={match.row.rowNumber} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_minmax(18rem,26rem)] md:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{match.row.fullName} <span className="text-xs font-normal text-muted-foreground">dòng {match.row.rowNumber}</span></p>
                    <p className="truncate text-sm text-muted-foreground">{match.row.positionText} · {match.row.unitText}</p>
                  </div>
                  <select aria-label={`Ghép ${match.row.fullName}`} value={choice} onChange={e => setChoices(cur => ({ ...cur, [match.row.rowNumber]: e.target.value }))}
                    className={`w-full ${inputCls} ${choice ? '' : 'border-amber-400 ring-2 ring-amber-400/30'}`}>
                    <option value="">— Chọn người trên Vioo —</option>
                    {match.candidates.map(id => { const row = data.rows.find(item => item.employeeId === id); return row ? <option key={id} value={id}>{personLabel(row, data)}</option> : null; })}
                    <option value="new">Không phải ai ở trên — tạo người mới</option>
                    <option value="skip">Bỏ qua dòng này</option>
                  </select>
                </li>;
              })}
            </ul>)}

          {tab === 'new' && (counts.new === 0 ? <StateBox kind="empty" title="Không có người mới" />
            : <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {plan.matches.filter(m => m.how === 'new').map(match => {
                const on = choices[match.row.rowNumber] === 'new';
                const noStart = !match.row.values.startDate;
                return <li key={match.row.rowNumber} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <input type="checkbox" aria-label={`Tạo hồ sơ ${match.row.fullName}`} checked={on} className="h-4 w-4 accent-teal-600"
                    onChange={e => setChoices(cur => ({ ...cur, [match.row.rowNumber]: e.target.checked ? 'new' : 'skip' }))} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{match.row.fullName}
                      {match.row.values.idNumber && <span className={`ml-2 text-xs ${ENT}`}>TT{String(match.row.values.idNumber).slice(-6)}</span>}</p>
                    <p className="truncate text-sm text-muted-foreground">{match.row.positionText} · {match.row.unitText}{match.row.values.startDate ? ` · vào ${dateVi(match.row.values.startDate)}` : ''}</p>
                  </div>
                  {noStart ? <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Chưa có ngày vào</Badge>
                    : <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200"><UserPlus size={11} />{on ? 'Tạo hồ sơ' : 'Không tạo'}</Badge>}
                </li>;
              })}
            </ul>)}

          {tab === 'changes' && <BatchItems items={items} data={data} collapsedByDefault />}

          {tab === 'missing' && (counts.missing === 0 ? <StateBox kind="empty" title="Mọi người đang làm đều có trong file" />
            : <section className="overflow-hidden rounded-2xl border border-border bg-card">
              <p className="flex items-center gap-2 border-b border-border bg-slate-50 px-4 py-2 text-sm text-muted-foreground dark:bg-slate-900"><UserX size={14} />Giữ nguyên trên Vioo. Người đã nghỉ thì cập nhật ở hồ sơ từng người.</p>
              <ul className="divide-y divide-border">{plan.notInFile.map(row => <li key={row.employeeId} className="px-4 py-2 text-sm">
                <span className={ENT}>{row.employeeCode}</span> <span className="font-semibold text-foreground">{row.fullName}</span>
                <span className="text-muted-foreground"> · {data.catalogs.positions.find(p => p.id === row.values.position)?.name || 'chưa có chức danh'}</span></li>)}</ul>
            </section>)}

          {tab === 'notes' && <section className="space-y-3">
            {unknownCatalog.length > 0 && <div className="overflow-hidden rounded-2xl border border-amber-200 bg-card dark:border-amber-900">
              <p className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertTriangle size={14} />Giá trị chưa có trong danh mục — ô này không được nhập</p>
              <ul className="divide-y divide-border">{unknownCatalog.map(entry => <li key={`${entry.field}:${entry.text}`} className="px-4 py-2 text-sm">
                <b>{fieldLabel(entry.field)}</b> “{entry.text}” · {entry.names.length} người: <span className="text-muted-foreground">{entry.names.join(', ')}</span></li>)}</ul>
            </div>}
            {plan.issues.length > 0 && <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-muted-foreground dark:bg-slate-900"><tr>
                  <th className="px-4 py-2">Dòng</th><th className="px-2 py-2">Người</th><th className="px-2 py-2">Cột</th><th className="px-2 py-2">Xử lý</th></tr></thead>
                <tbody className="divide-y divide-border">{plan.issues.map((issue, index) => <tr key={index}>
                  <td className="px-4 py-1.5 tabular-nums text-muted-foreground">{issue.rowNumber}</td><td className="px-2 py-1.5 font-semibold">{issue.fullName}</td>
                  <td className="px-2 py-1.5">{issue.column}</td><td className="px-2 py-1.5 text-muted-foreground">{issue.fix}</td></tr>)}</tbody>
              </table>
            </div>}
            {counts.notes === 0 && <StateBox kind="empty" title="File không có lỗi" />}
          </section>}
          <p className="text-xs text-muted-foreground">Ô trống trong file không xóa dữ liệu đang có trên Vioo. {MATCH_LABEL.name}: {plan.matches.filter(m => m.how === 'name').length} · {MATCH_LABEL.variant}: {plan.matches.filter(m => m.how === 'variant').length} · {MATCH_LABEL.phone}: {plan.matches.filter(m => m.how === 'phone').length} · {MATCH_LABEL.id}: {plan.matches.filter(m => m.how === 'id').length}</p>
        </>}
  </Drawer>;
};
