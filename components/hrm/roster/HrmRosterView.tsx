import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Download, FilePenLine, Hourglass, PencilLine, RefreshCw, Search, Send, TriangleAlert, Upload, Users2, X } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { matchesSearchQueryMultiple } from '../../../lib/searchUtils';
import { loadXlsx } from '../../../lib/loadXlsx';
import { StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import {
  ROSTER_GROUPS, blockOf, fieldLabel, formatValue, missingFields, salaryTotal, seniorityLabel, seniorityMonths,
  type RosterBatch, type RosterChangeItem, type RosterData, type RosterFieldKey, type RosterGroupKey, type RosterRow, type RosterValue,
} from '../../../lib/hrmRoster';
import { hrmRosterService } from '../../../lib/hrmRosterService';
import { RosterTable, groupRoster, rosterColumns, type RosterDraftMap } from './RosterTable';
import { RosterEditDrawer, type RosterDraftChange } from './RosterEditDrawer';
import { RosterDraftDrawer, draftTitle } from './RosterDraftDrawer';
import { RosterBatchesView } from './RosterBatches';
import { RosterImportDrawer } from './RosterImportDrawer';
import { useStoredState } from './rosterUi';

type QuickFilter = 'all' | 'missing' | 'pending' | 'draft';
type DraftEntries = Array<[string, Partial<Record<string, RosterValue>>]>;

const sameValue = (a: RosterValue | undefined, b: RosterValue | undefined) => (a ?? null) === (b ?? null);

/** Bảng nhân sự: HR sees the whole company like the "Data" sheet, changes cells, sends one request to HR Manage. */
const HrmRosterView: React.FC<{
  initialTab?: 'roster' | 'batches';
  initialBatchId?: string | null;
  /** Inside the Hồ sơ nhân sự page: no own background / padding. */
  embedded?: boolean;
  /** Called after an approval changed people, so other screens reload. */
  onDataChanged?: () => void;
}> = ({ initialTab = 'roster', initialBatchId = null, embedded = false, onDataChanged }) => {
  const toast = useToast();
  const [data, setData] = useState<RosterData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'roster' | 'batches'>(initialTab);
  const [block, setBlock] = useState('');
  const [unit, setUnit] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [query, setQuery] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  const [groups, setGroups] = useStoredState<RosterGroupKey[]>('hrm-roster-groups:v1', ['position', 'contract', 'personal']);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draftEntries, setDraftEntries] = useStoredState<DraftEntries>('hrm-roster-draft:v1', []);
  const [editing, setEditing] = useState<{ ids: string[]; field: RosterFieldKey | null } | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [batchReload, setBatchReload] = useState(0);
  const [batchCounts, setBatchCounts] = useState<{ pending: number; mine: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setStatus(cur => (cur === 'ready' ? cur : 'loading'));
    try {
      const next = await hrmRosterService.load();
      setData(next); setStatus('ready'); setMessage('');
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMessage(text); setStatus(/Chỉ HR/.test(text) ? 'denied' : 'error');
    } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const onCounts = useCallback((pending: number, mine: number) => setBatchCounts({ pending, mine }), []);
  useEffect(() => {
    if (!data) return;
    // Counts for the tab badge even before the tab is opened.
    hrmRosterService.listBatches('pending').then(list => onCounts(list.length, list.filter(b => b.awaitingMe).length)).catch(() => undefined);
  }, [data, batchReload, onCounts]);

  // Draft cleanup: drop people who left the roster and cells that are now pending or already equal.
  const draft: RosterDraftMap = useMemo(() => {
    const map: RosterDraftMap = new Map();
    if (!data) return map;
    draftEntries.forEach(([employeeId, changes]) => {
      const row = data.rows.find(item => item.employeeId === employeeId);
      if (!row) return;
      const kept = Object.fromEntries(Object.entries(changes).filter(([field, value]) =>
        !row.pending[field as RosterFieldKey] && !sameValue(row.values[field as RosterFieldKey], value)));
      if (Object.keys(kept).length) map.set(employeeId, kept);
    });
    return map;
  }, [draftEntries, data]);
  const draftCount = [...draft.values()].reduce((sum, changes) => sum + Object.keys(changes).length, 0);

  const applyChanges = (changes: RosterDraftChange[], silent = false) => {
    if (!data) return;
    setDraftEntries(cur => {
      const map = new Map(cur);
      changes.forEach(change => {
        const row = data.rows.find(item => item.employeeId === change.employeeId);
        const next = { ...(map.get(change.employeeId) || {}) };
        if (row && sameValue(row.values[change.field], change.value)) delete next[change.field];
        else next[change.field] = change.value;
        if (Object.keys(next).length) map.set(change.employeeId, next); else map.delete(change.employeeId);
      });
      return [...map.entries()];
    });
    setEditing(null);
    if (changes.length && !silent) toast.success(`Đã thêm ${changes.length} thay đổi vào phiếu nháp`, 'Bấm Gửi duyệt ở thanh dưới khi soạn xong.');
  };

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(row => {
      if (!showLeft && row.status !== 'Đang làm việc') return false;
      if (block && (blockOf(row, data.catalogs) || '') !== block) return false;
      if (unit && row.values.orgUnit !== unit) return false;
      if (quick === 'missing' && missingFields(row, data.can).length === 0) return false;
      if (quick === 'pending' && Object.keys(row.pending).length === 0) return false;
      if (quick === 'draft' && !draft.has(row.employeeId)) return false;
      if (!query.trim()) return true;
      const position = data.catalogs.positions.find(item => item.id === row.values.position)?.name;
      return matchesSearchQueryMultiple([row.fullName, row.employeeCode, row.values.legacyCode as string, position, row.values.phone as string,
        data.can.viewPersonal ? row.values.idNumber as string : null], query);
    });
  }, [data, showLeft, block, unit, quick, query, draft]);

  const active = data ? data.rows.filter(row => row.status === 'Đang làm việc') : [];
  const blockCounts = data ? data.catalogs.blocks.map(item => ({ ...item, n: active.filter(row => blockOf(row, data.catalogs) === item.code).length })) : [];
  const missingRows = data ? active.filter(row => missingFields(row, data.can).length > 0) : [];
  const topMissing = useMemo(() => {
    if (!data) return null;
    const tally = new Map<string, number>();
    missingRows.forEach(row => missingFields(row, data.can).forEach(field => tally.set(field, (tally.get(field) || 0) + 1)));
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? `${top[1]} thiếu ${fieldLabel(top[0]).toLowerCase()}` : null;
  }, [data, missingRows]);
  const pendingRows = data ? active.filter(row => Object.keys(row.pending).length > 0).length : 0;

  const selectRows = (ids: string[], on: boolean) => setSelected(cur => {
    const next = new Set(cur); ids.forEach(id => (on ? next.add(id) : next.delete(id))); return next;
  });

  const submitDraft = async ({ reason, effectiveDate }: { reason: string; effectiveDate: string }) => {
    if (!data) return;
    const items: RosterChangeItem[] = [];
    draft.forEach((changes, employeeId) => {
      const row = data.rows.find(item => item.employeeId === employeeId)!;
      Object.entries(changes).forEach(([field, value]) => items.push({
        employeeId, personKey: employeeId, employeeCode: row.employeeCode, fullName: row.fullName,
        field: field as RosterFieldKey, oldValue: row.values[field as RosterFieldKey] ?? null, newValue: value ?? null,
      }));
    });
    try {
      const result = await hrmRosterService.submit({ source: 'grid', title: draftTitle(draft), reason, effectiveDate, items });
      toast.success(`Đã gửi ${(result.codes || [result.code]).join(', ')}`, `${items.length} thay đổi chờ ${result.approverNames.join(', ') || 'người duyệt'} duyệt.${(result.codes || []).length > 1 ? ' Dòng của người duyệt tách phiếu riêng để người khác duyệt.' : ''}`);
      setDraftEntries([]); setSelected(new Set()); setDraftOpen(false); setBatchReload(n => n + 1);
      await load(true);
    } catch (e) { toast.error('Chưa gửi được phiếu', e instanceof Error ? e.message : ''); }
  };

  const submitImport = async (input: { title: string; reason: string; effectiveDate: string; items: RosterChangeItem[]; fileName: string }) => {
    try {
      const result = await hrmRosterService.submit({ source: 'import', ...input });
      toast.success(`Đã gửi ${(result.codes || [result.code]).join(', ')}`, `${input.items.length.toLocaleString('vi-VN')} thay đổi chờ ${result.approverNames.join(', ') || 'người duyệt'} duyệt.${(result.codes || []).length > 1 ? ' Dòng của người duyệt tách phiếu riêng để người khác duyệt.' : ''}`);
      setImportFile(null); setBatchReload(n => n + 1); setTab('batches');
      await load(true);
    } catch (e) { toast.error('Chưa gửi được phiếu nhập', e instanceof Error ? e.message : ''); }
  };

  const resubmit = (batch: RosterBatch) => {
    if (batch.source === 'import') { toast.info('Phiếu nhập Data', 'Sửa file rồi bấm Nhập Data để gửi lại.'); return; }
    applyChanges(batch.items.filter(item => item.employeeId && item.field !== 'employeeCode' && item.field !== 'fullName')
      .map(item => ({ employeeId: item.employeeId!, field: item.field as RosterFieldKey, value: item.newValue })));
    setTab('roster'); setDraftOpen(true);
  };

  const exportExcel = async () => {
    if (!data) return;
    const XLSX = await loadXlsx();
    const columns = rosterColumns(data, groups);
    const header = ['STT', 'Mã NV', 'Họ và tên', ...columns.map(column => column.label)];
    const aoa: (string | number | null)[][] = [['DATA NHÂN SỰ - TIẾN THỊNH'], [`Ngày xuất: ${new Date().toLocaleDateString('vi-VN')}`], header];
    let stt = 0;
    groupRoster(rows, data).forEach(group => {
      aoa.push([null, null, group.name.toUpperCase()]);
      group.units.forEach(unitGroup => {
        aoa.push([null, null, unitGroup.name]);
        unitGroup.rows.forEach(row => {
          stt += 1;
          aoa.push([stt, row.employeeCode, row.fullName, ...columns.map(column => {
            if (column.key === 'salaryTotal') return salaryTotal(row.values);
            if (column.key === 'salaryAfter') { const total = salaryTotal(row.values); return total == null ? null : total + (typeof row.values.seniorityAllowance === 'number' ? row.values.seniorityAllowance : 0); }
            if (column.key === 'seniority') return seniorityLabel(seniorityMonths(row.values.startDate ?? null, data.today));
            if (column.key === 'positionGroup') return data.catalogs.positions.find(p => p.id === row.values.position)?.groupCode || null;
            const value = row.values[column.field!] ?? null;
            return typeof value === 'number' ? value : formatValue(column.field!, value, data.catalogs) || null;
          })]);
        });
      });
    });
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet['!cols'] = [{ wch: 5 }, { wch: 10 }, { wch: 26 }, ...columns.map(column => ({ wch: Math.round(column.width / 7) }))];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Data');
    XLSX.writeFile(book, `Data_nhan_su_${data.today}.xlsx`);
    toast.success('Đã xuất Excel', `${stt} người · ${columns.length + 3} cột đang hiện${data.can.viewPay && groups.includes('pay') ? ' (có lương — bảo mật)' : ''}.`);
  };

  if (status === 'denied') return <main className="p-4"><StateBox kind="denied" title="Bạn chưa có quyền vào Bảng nhân sự" message={message} /></main>;
  if (status === 'error' && !data) return <main className="p-4"><StateBox kind="error" title="Chưa tải được Bảng nhân sự" message={message} onRetry={() => void load()} /></main>;
  if (!data) return <main className="p-4"><StateBox kind="loading" title="Đang tải Bảng nhân sự…" /></main>;

  const tiles: Array<{ key: QuickFilter; label: string; value: number; hint: React.ReactNode; icon: React.ElementType; tone: string }> = [
    { key: 'all', label: 'Đang làm', value: active.length, icon: Users2, tone: 'text-teal-700 dark:text-teal-300', hint: blockCounts.map(item => `${item.code} ${item.n}`).join(' · ') },
    { key: 'missing', label: 'Thiếu thông tin', value: missingRows.length, icon: TriangleAlert, tone: 'text-amber-700 dark:text-amber-300', hint: topMissing || 'đủ thông tin bắt buộc' },
    { key: 'pending', label: 'Chờ duyệt', value: pendingRows, icon: Hourglass, tone: 'text-indigo-700 dark:text-indigo-300',
      hint: !batchCounts ? 'đang đếm phiếu…' : batchCounts.mine ? <span className="font-semibold text-indigo-800 dark:text-indigo-200">{batchCounts.mine} phiếu chờ bạn duyệt</span> : `${batchCounts.pending} phiếu đang chờ` },
    ...(data.can.edit ? [{ key: 'draft' as const, label: 'Đang soạn', value: draftCount, icon: FilePenLine, tone: 'text-sky-700 dark:text-sky-300', hint: draftCount ? `${draft.size} người · chưa gửi` : 'chưa có thay đổi' }] : []),
  ];

  return <main className={embedded ? 'space-y-4 pb-24 text-foreground' : 'min-h-screen space-y-4 bg-slate-50 px-3 py-4 pb-24 text-foreground dark:bg-slate-950 sm:px-5 md:py-5'}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-600 to-leaf-500 text-white shadow-sm"><Users2 size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Bảng nhân sự</h1>
          <p className="text-sm text-muted-foreground"><b className="tabular-nums text-foreground">{active.length}</b> đang làm · {blockCounts.filter(item => item.n).length} khối · {data.catalogs.orgUnits.length} bộ phận</p>
        </div>
      </div>
      <span className="flex flex-wrap items-center gap-2">
        {data.can.import && <>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setImportFile(file); }} />
          <button type="button" onClick={() => fileRef.current?.click()} className={`${secondaryBtn} bg-card`} title="Tải file Data nhân sự theo mẫu chuẩn"><Upload size={15} />Nhập Data</button>
        </>}
        <button type="button" onClick={() => void exportExcel()} className={`${secondaryBtn} bg-card`}><Download size={15} />Xuất Excel</button>
        <button type="button" onClick={() => { void load(true); setBatchReload(n => n + 1); }} disabled={refreshing} className={`${secondaryBtn} bg-card`} aria-label="Làm mới">
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /><span className="hidden sm:inline">Làm mới</span></button>
      </span>
    </header>

    <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm" role="tablist" aria-label="Bảng nhân sự">
      {([['roster', 'Bảng nhân sự', 0], ['batches', 'Phiếu thay đổi', batchCounts?.pending || 0]] as const).map(([key, label, n]) =>
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === key ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
          {key === 'roster' ? <Users2 size={15} /> : <ClipboardList size={15} />}{label}
          {n > 0 && <span className={`rounded-full px-1.5 text-xs tabular-nums ${tab === key ? 'bg-white/20' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100'}`}>{n}</span>}</button>)}
    </div>

    {tab === 'batches' ? <RosterBatchesView data={data} reloadKey={batchReload} initialOpenId={initialBatchId}
      onChanged={() => { void load(true); onDataChanged?.(); }} onResubmit={resubmit} onCounts={onCounts} /> : <>
      <nav aria-label="Lọc nhanh" className={`grid grid-cols-2 gap-2 ${tiles.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        {tiles.map((tile, i) => {
          const Icon = tile.icon; const on = quick === tile.key;
          return <button key={tile.key} type="button" aria-pressed={on} onClick={() => setQuick(on && tile.key !== 'all' ? 'all' : tile.key)}
            className={`rounded-2xl border bg-card p-3 text-left shadow-sm transition md:p-4 ${on ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i + 1}</span>{tile.label}</span>
            <span className="mt-2 flex items-center gap-2"><Icon size={18} className={tile.tone} /><span className="text-2xl font-bold tabular-nums text-foreground">{tile.value}</span></span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{tile.hint}</span>
          </button>;
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5 text-sm" role="group" aria-label="Khối">
          {[{ code: '', label: 'Tất cả' }, ...blockCounts.map(item => ({ code: item.code, label: item.code }))].map(item =>
            <button key={item.code || 'all'} type="button" aria-pressed={block === item.code} onClick={() => { setBlock(item.code); setUnit(''); }}
              title={data.catalogs.blocks.find(b => b.code === item.code)?.name}
              className={`whitespace-nowrap rounded-md px-3 py-1 font-semibold ${block === item.code ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{item.label}</button>)}
        </div>
        <select aria-label="Bộ phận" value={unit} onChange={e => setUnit(e.target.value)} className={`min-w-0 max-w-[16rem] ${inputCls}`}>
          <option value="">Mọi bộ phận</option>
          {data.catalogs.orgUnits.filter(item => !block || item.blockCode === block).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <label className="relative min-w-[12rem] flex-1">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={data.can.viewPersonal ? 'Tìm tên, mã NV, SĐT, CCCD, chức danh…' : 'Tìm tên, mã NV, chức danh…'} className={`w-full pl-8 ${inputCls}`} />
        </label>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Nhóm cột">
          {ROSTER_GROUPS.filter(group => (group.key !== 'personal' || data.can.viewPersonal) && (group.key !== 'pay' || data.can.viewPay)).map(group => {
            const on = groups.includes(group.key);
            return <button key={group.key} type="button" aria-pressed={on} onClick={() => setGroups(cur => on ? cur.filter(key => key !== group.key) : [...cur, group.key])}
              className={`hidden rounded-full border px-2.5 py-1 text-xs font-semibold md:inline-flex ${on ? `border-transparent ${group.tone}` : 'border-border text-muted-foreground hover:text-foreground'}`}>{group.label}</button>;
          })}
        </div>
        <label className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
          <input type="checkbox" checked={showLeft} onChange={e => setShowLeft(e.target.checked)} className="h-3.5 w-3.5 accent-teal-600" />Cả người đã nghỉ</label>
        {(block || unit || query || quick !== 'all') && <button type="button" onClick={() => { setBlock(''); setUnit(''); setQuery(''); setQuick('all'); }}
          className="rounded-lg px-2 py-1.5 text-sm font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">Xóa lọc</button>}
      </div>

      {status === 'error' && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{message}</p>}

      {rows.length === 0 ? <StateBox kind="empty" title="Không có người nào khớp bộ lọc" message={quick === 'missing' ? 'Mọi người đã đủ thông tin bắt buộc.' : undefined} />
        : <RosterTable rows={rows} data={data} groups={groups} selected={selected} draft={draft} onSelect={selectRows}
          onEditCell={(employeeId, field) => setEditing({ ids: [employeeId], field })}
          onOpenPerson={employeeId => data.can.edit && setEditing({ ids: [employeeId], field: null })} />}
    </>}

    {data.can.edit && tab === 'roster' && (selected.size > 0 || draftCount > 0) && <div className="sticky bottom-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-card px-3 py-2.5 shadow-lg dark:border-teal-900">
      {selected.size > 0 && <>
        <span className="text-sm font-semibold">Đã chọn <b className="tabular-nums">{selected.size}</b> người</span>
        <button type="button" onClick={() => setEditing({ ids: [...selected], field: selected.size > 1 ? 'position' : null })} className={primaryBtn}><PencilLine size={15} />Đổi thông tin</button>
        <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"><X size={14} className="inline" /> Bỏ chọn</button>
      </>}
      {draftCount > 0 && <span className={`flex items-center gap-2 ${selected.size > 0 ? 'w-full border-t border-border pt-2 sm:ml-auto sm:w-auto sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0' : 'w-full sm:w-auto'}`}>
        <span className="text-sm"><b className="tabular-nums text-sky-700 dark:text-sky-300">{draftCount}</b> thay đổi · {draft.size} người</span>
        <button type="button" onClick={() => setDraftOpen(true)} className={selected.size > 0 ? secondaryBtn : primaryBtn}><Send size={15} />Xem & gửi duyệt</button>
      </span>}
    </div>}

    {editing && <RosterEditDrawer data={data} people={editing.ids.map(id => data.rows.find(row => row.employeeId === id)!).filter(Boolean)}
      focusField={editing.field} draft={draft} onClose={() => setEditing(null)} onApply={applyChanges} />}
    {draftOpen && <RosterDraftDrawer data={data} rows={data.rows} draft={draft} onClose={() => setDraftOpen(false)}
      onRemove={(employeeId, field) => applyChanges([{ employeeId, field, value: data.rows.find(row => row.employeeId === employeeId)?.values[field] ?? null }], true)}
      onClear={() => { setDraftEntries([]); setDraftOpen(false); }} onSubmit={submitDraft} />}
    {importFile && <RosterImportDrawer data={data} file={importFile} onClose={() => setImportFile(null)} onSubmit={submitImport} />}
  </main>;
};

export default HrmRosterView;
