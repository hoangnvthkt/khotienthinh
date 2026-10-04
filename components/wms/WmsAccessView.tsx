import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, BookOpen, CheckCircle2, ChevronDown, Copy, Eye, Hash, History, Info, Lock, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Trash2, UserPlus, Wand2, Warehouse, X } from 'lucide-react';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { foldVi, ownersErrorMessage, wmsAccessService } from '../../lib/wmsCatalogService';
import {
  LEGACY_LABEL, WMS_ACCESS_TEMPLATES, WMS_JOB, WMS_JOBS, WMS_LIST_JOBS, WMS_TIERS, accessDiff, accessFromGrants, applyTemplate, canPropose, copyJobs, handOver,
  jobsOf, keeperWarehouses, legacyGroups, stripPerson, viewImplied, viewOf, type LegacyGrant, type WmsAccess, type WmsAccessData, type WmsJob,
} from '../../lib/wmsAccess';
import { GREY, OK, TEAL, WARN, dateVi } from './wmsUi';

// Kho vật tư → Phân quyền kho: giao 8 việc (Xem kho, Đề xuất mã, Thủ kho, Cấp mã, Duyệt ngoại lệ, Kế toán kho, Khóa kỳ, Quản lý danh sách kho).
// Ai xem được kho đều xem; chỉ Admin sửa. Lưu một lần, có nhật ký. Thay màn Người phụ trách (V1-2).

const ICON: Record<WmsJob, React.ElementType> = { view: Eye, propose: Send, keeper: Warehouse, code: Hash, exception: ShieldCheck, accounting: BookOpen, closer: Lock, whAdmin: Settings2 };
const TABLE_JOBS: WmsJob[] = ['propose', 'code', 'exception', 'accounting', 'closer', 'whAdmin'];
type Users = WmsAccessData['users'];

const Does: React.FC<{ items: string[] }> = ({ items }) => {
  const [open, setOpen] = useState(false);
  return <div><button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300"><Info size={12} />Làm được gì<ChevronDown size={12} className={open ? 'rotate-180' : ''} /></button>
    {open && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{items.map(x => <li key={x}>{x}</li>)}</ul>}</div>;
};

const PersonPick: React.FC<{ users: Users; label: string; exclude: string[]; onPick: (id: string) => void; children?: React.ReactNode; btnCls?: string }> = ({ users, label, exclude, onPick, children, btnCls }) => {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const hits = q.trim() ? users.filter(u => !exclude.includes(u.id) && foldVi(u.name).includes(foldVi(q.trim()))).slice(0, 7) : [];
  return <span className="relative">
    <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
      className={btnCls || 'inline-flex items-center gap-1 rounded-full border border-dashed border-teal-400 px-2.5 py-1 text-sm font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40'}>{children || <><UserPlus size={13} />Thêm</>}</button>
    {open && <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-xl border border-border bg-card p-2 shadow-xl">
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Gõ tên (không cần dấu)…" aria-label={label} className={`w-full ${inputCls}`} />
      <ul className="mt-1 max-h-64 overflow-y-auto">{hits.map(u => <li key={u.id}><button type="button" onClick={() => { onPick(u.id); setQ(''); setOpen(false); }} className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
        {u.name}{u.position && <span className="ml-1 text-xs text-muted-foreground">{u.position}</span>}</button></li>)}
        {q.trim() && hits.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">Không thấy</li>}</ul></div>}
  </span>;
};

const Chips: React.FC<{ users: Users; ids: string[]; was: string[]; canEdit: boolean; label: string; limit?: number; onChange: (ids: string[]) => void; onOpen: (id: string) => void }> =
  ({ users, ids, was, canEdit, label, limit, onChange, onOpen }) => {
    const [all, setAll] = useState(false);
    const name = (id: string) => users.find(u => u.id === id)?.name || id;
    const removed = was.filter(x => !ids.includes(x));
    const shown = limit && !all ? ids.slice(0, limit) : ids;
    return <div className="flex flex-wrap items-center gap-1.5">
      {shown.map(id => { const isNew = !was.includes(id); return <span key={id} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm ${isNew ? 'border-leaf-300 bg-leaf-50 text-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-200' : 'border-mint-200 bg-mint-50 text-mint-800 dark:bg-mint-950/40 dark:text-mint-200'}`}>
        <button type="button" onClick={() => onOpen(id)} className="hover:underline">{name(id)}</button>{isNew && <span className="text-[10px] font-bold uppercase">mới</span>}
        {canEdit && <button type="button" aria-label={`Bỏ ${name(id)} khỏi ${label}`} onClick={() => onChange(ids.filter(x => x !== id))} className="rounded-full p-0.5 hover:bg-white/70"><X size={12} /></button>}</span>; })}
      {limit && ids.length > limit && <button type="button" onClick={() => setAll(v => !v)} className="text-xs font-semibold text-teal-700 dark:text-teal-300">{all ? 'Thu gọn' : `+${ids.length - limit} người`}</button>}
      {removed.map(id => <span key={id} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><span className="line-through">{name(id)}</span>
        {canEdit && <button type="button" aria-label={`Giữ ${name(id)}`} onClick={() => onChange([...ids, id])} className="rounded-full p-0.5 hover:bg-white"><Plus size={12} /></button>}</span>)}
      {ids.length === 0 && removed.length === 0 && <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Chưa có ai</span>}
      {canEdit && <PersonPick users={users} label={`Tìm người cho ${label}`} exclude={ids} onPick={id => onChange([...ids, id])} />}
    </div>;
  };

const PersonDrawer: React.FC<{ id: string; data: WmsAccessData; cur: WmsAccess; base: WmsAccess; canEdit: boolean; set: (f: (a: WmsAccess) => WmsAccess) => void; onClose: () => void; say: (s: string) => void }> =
  ({ id, data, cur, base, canEdit, set, onClose, say }) => {
    const [tpl, setTpl] = useState('');
    const [replace, setReplace] = useState(false);
    const [handTo, setHandTo] = useState<string | null>(null);
    const [keepView, setKeepView] = useState(true);
    const u = data.users.find(x => x.id === id);
    const name = (x: string | null) => (x && data.users.find(y => y.id === x)?.name) || '—';
    const whName = (w: string) => data.warehouses.find(x => x.id === w)?.name || w;
    const v = viewOf(cur, id); const implied = viewImplied(cur, id);
    const ring = (on: boolean, was: boolean) => on !== was ? (on ? 'ring-2 ring-leaf-300' : 'ring-2 ring-rose-200') : '';
    const t = WMS_ACCESS_TEMPLATES.find(x => x.k === tpl);
    const setView = (k: 'all' | 'some' | 'none') => set(a => {
      const n: WmsAccess = { ...a, viewAll: a.viewAll.filter(x => x !== id), viewWh: Object.fromEntries(Object.entries(a.viewWh).map(([w, l]) => [w, l.filter(x => x !== id)])) };
      if (k === 'all') n.viewAll = [...n.viewAll, id];
      if (k === 'some') { const ks = keeperWarehouses(a, id); (ks.length ? ks : [data.warehouses[0]?.id]).filter(Boolean).forEach(w => { n.viewWh[w] = [...(n.viewWh[w] || []), id]; }); }
      return n;
    });
    const jobs = jobsOf(cur, id, whName);
    return <Drawer label={u?.name || 'Người dùng'} onClose={onClose}
      header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phân quyền kho</p><h2 className={`text-lg ${ENT}`}>{u?.name}</h2>
        <p className="text-sm text-muted-foreground">{u?.position || 'Chưa có chức vụ'}</p></>}
      footer={<button type="button" className={primaryBtn} onClick={onClose}>Xong</button>}>
      {canEdit && <section className="rounded-xl border border-teal-200 bg-teal-50/50 p-3 dark:border-teal-900 dark:bg-teal-950/20">
        <h3 className="flex items-center gap-1 text-sm font-bold"><Wand2 size={14} />Điền nhanh</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={tpl} onChange={e => setTpl(e.target.value)} aria-label="Mẫu chức năng" className={`min-w-0 flex-1 ${inputCls}`}><option value="">Theo mẫu chức năng…</option>
            {WMS_ACCESS_TEMPLATES.map(x => <option key={x.k} value={x.k}>{x.label}{x.like ? ` (như ${x.like})` : ''}</option>)}</select>
          <button type="button" className={secondaryBtn} disabled={!t} onClick={() => { if (!t) return; set(a => applyTemplate(a, id, t, replace)); say(`Đã điền mẫu “${t.label}”. Xem lại rồi bấm Lưu.`); }}>Điền</button>
        </div>
        {t && <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <PersonPick users={data.users} label="Giống người" exclude={[id]} btnCls={secondaryBtn} onPick={from => { set(a => copyJobs(replace ? stripPerson(a, id) : a, from, id)); say(`Đã điền các việc giống ${name(from)}. Xem lại rồi bấm Lưu.`); }}><Copy size={14} />Giống một người…</PersonPick>
          <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Thay việc đang có (không tick = thêm vào)</label>
        </div>
      </section>}
      <section><h3 className="mb-1 flex items-center gap-1 text-sm font-bold"><Eye size={14} />Xem kho</h3>
        {implied ? <p className={`rounded-xl border px-3 py-2 text-sm ${TEAL}`}>Xem mọi kho — có sẵn theo việc Cấp mã / Duyệt ngoại lệ / Kế toán kho.</p>
          : <><div className="flex flex-wrap gap-1.5 text-sm">{([['all', 'Mọi kho'], ['some', 'Chọn kho'], ['none', 'Không xem']] as const).map(([k, l]) => {
            const on = k === 'all' ? v === 'all' : k === 'none' ? v !== 'all' && v.length === 0 : v !== 'all' && v.length > 0;
            return <button key={k} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => setView(k)}
              className={`rounded-full border px-3 py-1 font-semibold ${on ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card'}`}>{l}</button>; })}</div>
            {v !== 'all' && v.length > 0 && <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{data.warehouses.map(w => { const on = (cur.viewWh[w.id] || []).includes(id);
              return <label key={w.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm"><input type="checkbox" disabled={!canEdit} checked={on}
                onChange={() => set(a => ({ ...a, viewWh: { ...a.viewWh, [w.id]: on ? (a.viewWh[w.id] || []).filter(x => x !== id) : [...(a.viewWh[w.id] || []), id] } }))} />{w.name}</label>; })}</div>}
            <p className="mt-1 text-xs text-muted-foreground">Thủ kho luôn xem được kho mình giữ.</p></>}
      </section>
      <section><h3 className="mb-1 flex items-center gap-1 text-sm font-bold"><Warehouse size={14} />Thủ kho ở kho nào</h3>
        <div className="grid gap-2 sm:grid-cols-2">{data.warehouses.map(w => { const on = (cur.keepers[w.id] || []).includes(id); const was = (base.keepers[w.id] || []).includes(id);
          return <label key={w.id} className={`flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm ${ring(on, was)} ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
            <input type="checkbox" disabled={!canEdit} checked={on} onChange={() => set(a => ({ ...a, keepers: { ...a.keepers, [w.id]: on ? (a.keepers[w.id] || []).filter(x => x !== id) : [...(a.keepers[w.id] || []), id] } }))} />
            <span className="flex-1">{w.name}</span></label>; })}</div></section>
      <section><h3 className="mb-1 text-sm font-bold">Việc toàn công ty</h3>
        <div className="space-y-2">{(['propose', 'code', 'exception', 'accounting', 'closer', 'whAdmin'] as WmsJob[]).map(k => {
          const on = k === 'closer' ? cur.closer === id : (cur as any)[k].includes(id); const was = k === 'closer' ? base.closer === id : (base as any)[k].includes(id);
          const block = k === 'closer' && !cur.accounting.includes(id) ? 'Phải là Kế toán kho trước' : '';
          const auto = k === 'propose' && !on && canPropose(cur, id);
          return <label key={k} className={`flex items-start gap-2 rounded-xl border border-border px-3 py-2 text-sm ${ring(on, was)} ${canEdit && !block ? 'cursor-pointer' : 'opacity-80'}`}>
            <input type="checkbox" className="mt-1" disabled={!canEdit || !!block} checked={on || auto} onChange={() => set(a => k === 'closer' ? { ...a, closer: on ? null : id }
              : { ...a, [k]: on ? (a as any)[k].filter((x: string) => x !== id) : [...(a as any)[k], id], ...(k === 'accounting' && on && a.closer === id ? { closer: null } : {}) })} />
            <span className="flex-1"><b>{WMS_JOB[k].label}</b> <span className="text-xs text-muted-foreground">· {WMS_JOB[k].tier}{k === 'closer' && cur.closer && cur.closer !== id ? ` · đang là ${name(cur.closer)}` : ''}{auto ? ' · có sẵn theo việc khác' : ''}</span>
              <span className="block text-xs text-muted-foreground">{block || WMS_JOB[k].does.join(' · ')}</span></span></label>; })}</div></section>
      {canEdit && jobs.length > 0 && <section className="rounded-xl border border-border p-3"><h3 className="flex items-center gap-1 text-sm font-bold"><ArrowRightLeft size={14} />Bàn giao</h3>
        <p className="mt-1 text-xs text-muted-foreground">Khi {u?.name} nghỉ hoặc đổi việc: chuyển hết việc kho sang một người khác trong một lần.</p>
        {handTo ? <div className="mt-2 space-y-2 text-sm"><p>Chuyển cho <b className={ENT}>{name(handTo)}</b>:</p><ul className="list-disc pl-5 text-xs">{jobs.map(x => <li key={x}>{x}</li>)}</ul>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepView} onChange={e => setKeepView(e.target.checked)} />{u?.name} vẫn giữ Xem mọi kho</label>
          <div className="flex gap-2"><button type="button" className={secondaryBtn} onClick={() => setHandTo(null)}>Hủy</button>
            <button type="button" className={primaryBtn} onClick={() => { set(a => handOver(a, id, handTo, keepView)); say(`Đã chuẩn bị bàn giao cho ${name(handTo)}. Xem lại rồi bấm Lưu.`); setHandTo(null); }}>Bàn giao</button></div></div>
          : <div className="mt-2"><PersonPick users={data.users} label="Bàn giao cho" exclude={[id]} onPick={setHandTo} btnCls={secondaryBtn}><ArrowRightLeft size={14} />Bàn giao cho…</PersonPick></div>}
      </section>}
    </Drawer>;
  };

export const WmsAccessView: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<WmsAccessData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [base, setBase] = useState<WmsAccess | null>(null);
  const [cur, setCur] = useState<WmsAccess | null>(null);
  const [view, setView] = useState<'jobs' | 'people' | 'old'>('jobs');
  const [person, setPerson] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<LegacyGrant[]>([]);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState(s => (s === 'ready' ? s : 'loading'));
    try { const d = await wmsAccessService.get(); const a = accessFromGrants(d); setData(d); setBase(a); setCur(a); setRevoke([]); setPick({}); setState('ready'); }
    catch (e) { setMessage(ownersErrorMessage(e, 'Chưa tải được phân quyền kho.')); setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const name = useCallback((id: string | null) => (id && data?.users.find(u => u.id === id)?.name) || '—', [data]);
  const whName = useCallback((id: string) => data?.warehouses.find(w => w.id === id)?.name || id, [data]);
  const whShort = (id: string) => whName(id).replace(/^Kho /, '');
  const diff = useMemo(() => (base && cur ? accessDiff(base, cur, name, whName, revoke) : []), [base, cur, name, whName, revoke]);
  const groups = useMemo(() => (data && base ? legacyGroups(data, base) : []), [data, base]);

  if (state === 'loading' && !data) return <StateBox kind="loading" title="Đang tải phân quyền kho…" />;
  if (state === 'error' && !data) return <StateBox kind={/quyền/.test(message) ? 'denied' : 'error'} title="Chưa mở được Phân quyền kho" message={message} onRetry={() => void load()} />;
  if (!data || !base || !cur) return null;
  const canEdit = data.can.edit;
  const set = (f: (a: WmsAccess) => WmsAccess) => setCur(c => (c ? f(c) : c));
  const say = (s: string) => toast.success('Đã điền', s);
  const revokedKey = (g: LegacyGrant) => `${g.userId}|${g.code}|${g.scopeType}|${g.scopeId}`;
  const openGroups = groups.filter(g => !g.grants.every(x => revoke.some(r => revokedKey(r) === revokedKey(x))));
  const people = [...new Set([...Object.values(cur.keepers).flat(), ...WMS_LIST_JOBS.flatMap(k => cur[k]), ...(cur.closer ? [cur.closer] : []),
    ...Object.values(base.keepers).flat(), ...WMS_LIST_JOBS.flatMap(k => base[k]), ...Object.values(cur.viewWh).flat()])].sort((a, b) => name(a).localeCompare(name(b), 'vi'));
  const viewersOnly = cur.viewAll.filter(id => !people.includes(id));
  const sod: string[] = [];
  data.warehouses.forEach(w => (cur.keepers[w.id] || []).forEach(id => {
    if (cur.closer === id) sod.push(`${name(id)} là thủ kho ${w.name} và người khóa kỳ → tồn ${w.name} phải được người Duyệt ngoại lệ / Admin xác nhận trước khi khóa.`);
    if (cur.exception.includes(id)) sod.push(`${name(id)} là thủ kho ${w.name} và Duyệt ngoại lệ → không tự duyệt phiếu ngoại lệ do mình lập.`);
  }));
  const save = async () => {
    setSaving(true);
    try { const r = await wmsAccessService.save(cur, revoke); toast.success('Đã lưu phân quyền kho', `Thêm ${r.added}, gỡ ${r.removed} quyền. Người được đổi đăng nhập lại để thấy đúng.`); setAsk(false); await load(); }
    catch (e) { toast.error('Chưa lưu được', ownersErrorMessage(e)); }
    finally { setSaving(false); }
  };
  const tableRows = [...people, ...(q.trim() ? viewersOnly : [])].filter(id => !q.trim() || foldVi(name(id)).includes(foldVi(q.trim())));

  return <div className="space-y-3 pb-24">
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-muted p-1 scrollbar-hide" role="tablist" aria-label="Cách xem">{([['jobs', 'Theo việc'], ['people', 'Theo người'], ['old', `Quyền cũ cần dọn (${openGroups.length})`]] as const).map(([k, l]) =>
        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-card text-teal-800 shadow-sm dark:text-teal-200' : 'text-muted-foreground'}`}>{l}</button>)}</div>
      <p className="mr-auto text-xs text-muted-foreground">{canEdit ? 'Xanh lá = sẽ thêm · gạch đỏ = sẽ gỡ. Lưu một lần, có nhật ký.' : 'Bạn đang xem — chỉ Admin sửa.'}</p>
      {canEdit && <PersonPick users={data.users} label="Phân quyền cho một người" exclude={[]} onPick={id => setPerson(id)} btnCls={`${secondaryBtn} bg-card`}><UserPlus size={15} />Phân quyền cho một người</PersonPick>}
      <button type="button" className={`${secondaryBtn} bg-card`} onClick={() => void load()}><RefreshCw size={15} />Làm mới</button>
    </div>

    {view === 'jobs' && <div className="space-y-4">{WMS_TIERS.map(tier => <section key={tier}>
      <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Bậc {tier}</h2>
      <div className="grid gap-3 lg:grid-cols-2">{WMS_JOBS.filter(j => j.tier === tier).map(J => { const Icon = ICON[J.k]; return <article key={J.k} className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${J.k === 'keeper' || J.k === 'view' ? 'lg:col-span-2' : ''}`}>
        <div className="flex flex-wrap items-start gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white"><Icon size={16} /></span>
          <div className="min-w-0 flex-1"><h3 className="font-bold">{J.label} <span className="text-xs font-normal text-muted-foreground">{J.scope === 'kho' ? 'theo từng kho' : J.scope === 'một người' ? 'một người' : 'toàn công ty'}</span></h3></div><Does items={J.does} /></div>
        {J.k === 'view' ? <div className="mt-2 space-y-2"><p className="text-xs font-semibold text-muted-foreground">Mọi kho · <span className={NUM}>{cur.viewAll.length}</span> người · Cấp mã, Duyệt ngoại lệ, Kế toán kho luôn xem được</p>
          <Chips users={data.users} label="Xem kho mọi kho" ids={cur.viewAll} was={base.viewAll} canEdit={canEdit} limit={12} onOpen={setPerson} onChange={ids => set(a => ({ ...a, viewAll: ids }))} />
          {data.warehouses.filter(w => (cur.viewWh[w.id] || []).length || (base.viewWh[w.id] || []).length).map(w => <div key={w.id}><p className="text-xs font-semibold text-muted-foreground">Chỉ {w.name}</p>
            <Chips users={data.users} label={`Xem ${w.name}`} ids={cur.viewWh[w.id] || []} was={base.viewWh[w.id] || []} canEdit={canEdit} onOpen={setPerson} onChange={ids => set(a => ({ ...a, viewWh: { ...a.viewWh, [w.id]: ids } }))} /></div>)}</div>
          : J.k === 'keeper' ? <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.warehouses.map(w => <div key={w.id} className="rounded-xl border border-border p-3">
            <p className={ENT}>{w.name}</p><p className="mb-1.5 text-xs text-muted-foreground">{w.project || (w.type === 'GENERAL' ? 'kho tổng' : w.type === 'OFFICE' ? 'kho văn phòng' : '—')}</p>
            <Chips users={data.users} label={`thủ kho ${w.name}`} ids={cur.keepers[w.id] || []} was={base.keepers[w.id] || []} canEdit={canEdit} onOpen={setPerson} onChange={ids => set(a => ({ ...a, keepers: { ...a.keepers, [w.id]: ids } }))} />
            {data.activity.filter(x => x.warehouseId === w.id).length > 0 && <p className="mt-2 text-xs text-muted-foreground">Lập phiếu 60 ngày: {data.activity.filter(x => x.warehouseId === w.id).sort((a, b) => b.n - a.n).map(x => <span key={x.userId} className="mr-2">{name(x.userId)} <span className={NUM}>{x.n}</span></span>)}</p>}</div>)}</div>
          : J.k === 'closer' ? <label className="mt-2 block text-sm">Người khóa kỳ <span className="text-xs text-muted-foreground">(chọn trong Kế toán kho)</span>
            <select disabled={!canEdit} value={cur.closer || ''} onChange={e => set(a => ({ ...a, closer: e.target.value || null }))} className={`mt-1 w-full ${inputCls}`}><option value="">Chưa chọn</option>{cur.accounting.map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>
          : <div className="mt-2"><Chips users={data.users} label={J.label} ids={(cur as any)[J.k]} was={(base as any)[J.k]} canEdit={canEdit} onOpen={setPerson}
            onChange={ids => set(a => ({ ...a, [J.k]: ids, ...(J.k === 'accounting' && a.closer && !ids.includes(a.closer) ? { closer: null } : {}) }))} />
            {J.k === 'propose' && <p className="mt-1.5 text-xs text-muted-foreground">Thủ kho, người Cấp mã tự có. Thêm ở đây cho người khác (chỉ huy, mua hàng) muốn gửi đề xuất.</p>}
            {J.k === 'exception' && <p className="mt-1.5 text-xs text-muted-foreground">Admin luôn có.</p>}
            {J.k === 'whAdmin' && <p className="mt-1.5 text-xs text-muted-foreground">Tạo / sửa / xóa kho. Thủ kho không tự sửa được thông tin kho mình giữ. Riêng màn Phân quyền kho luôn chỉ Admin.</p>}</div>}
      </article>; })}</div></section>)}
      {sod.length > 0 && <div className={`rounded-2xl border px-4 py-3 text-sm ${WARN}`}><p className="font-semibold"><AlertTriangle size={14} className="mr-1 inline" />Tách nhiệm — hệ thống tự chặn khi thao tác</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{sod.map(s => <li key={s}>{s}</li>)}</ul></div>}
    </div>}

    {view === 'people' && <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2"><label className="relative min-w-[12rem] flex-1"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm người (không cần dấu)…" className={`w-full pl-8 ${inputCls}`} /></label>
        <span className="text-xs text-muted-foreground">{people.length} người có việc kho · {viewersOnly.length} người chỉ xem</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Người</th><th className="px-2 py-2 font-medium">Xem kho</th><th className="px-2 py-2 font-medium">Thủ kho</th>
          {TABLE_JOBS.map(k => <th key={k} className="px-2 py-2 text-center font-medium">{WMS_JOB[k].label}</th>)}</tr></thead>
        <tbody>{tableRows.map(id => { const u = data.users.find(x => x.id === id); const v = viewOf(cur, id); const ks = keeperWarehouses(cur, id);
          const changed = JSON.stringify(jobsOf(cur, id, whName)) !== JSON.stringify(jobsOf(base, id, whName));
          return <tr key={id} onClick={() => setPerson(id)} className={`cursor-pointer border-t border-border hover:bg-teal-50/40 dark:hover:bg-teal-950/20 ${changed ? 'bg-leaf-50/40 dark:bg-leaf-950/20' : ''}`}>
            <td className="px-3 py-2"><span className={ENT}>{name(id)}</span>{changed && <Badge className={OK}>đổi</Badge>}<span className="block text-xs text-muted-foreground">{u?.position || '—'}</span></td>
            <td className="px-2 py-2 text-xs">{v === 'all' ? 'Mọi kho' : viewImplied(cur, id) ? <span className="text-slate-500">Mọi kho (theo việc)</span> : v.length ? v.map(whShort).join(', ') : ks.length ? <span className="text-muted-foreground">kho mình</span> : <span className="text-rose-700 dark:text-rose-300">không</span>}</td>
            <td className="px-2 py-2">{ks.length ? <span className="flex flex-wrap gap-1">{ks.map(w => <Badge key={w} className={TEAL}>{whShort(w)}</Badge>)}</span> : <span className="text-muted-foreground">—</span>}</td>
            {TABLE_JOBS.map(k => { const on = k === 'closer' ? cur.closer === id : (cur as any)[k].includes(id); const auto = k === 'propose' && !on && canPropose(cur, id);
              return <td key={k} className="px-2 py-2 text-center">{on || auto ? <CheckCircle2 size={16} className={`inline ${auto ? 'text-slate-400' : 'text-leaf-600'}`} aria-label={auto ? 'có sẵn theo việc khác' : 'có'} /> : <span className="text-muted-foreground">—</span>}</td>; })}</tr>; })}
          {tableRows.length === 0 && <tr><td colSpan={3 + TABLE_JOBS.length} className="px-3 py-10 text-center text-sm text-muted-foreground">Không thấy người khớp.</td></tr>}</tbody></table></div>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Bấm một người để xem{canEdit ? ', điền theo mẫu, giống người khác, hoặc bàn giao' : ''}. Dấu xám = có sẵn theo việc khác. {viewersOnly.length} người chỉ xem kho — gõ tên để tìm.</p>
    </div>}

    {view === 'old' && <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <p className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Ô quyền kỹ thuật kiểu cũ còn cấp lẻ. Ô đã nằm trong Thủ kho thì gỡ cho gọn — không mất thao tác nào.</p>
      {openGroups.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Không còn quyền cũ.</p>
        : <ul className="divide-y divide-border">{openGroups.map(g => { const on = g.grants.every(x => pick[revokedKey(x)] ?? g.verdict === 'covered');
          return <li key={g.key} className="flex items-start gap-2 px-3 py-2.5">
            {canEdit && <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-600" aria-label={`Chọn ${name(g.userId)}`} checked={on} onChange={e => setPick(p => ({ ...p, ...Object.fromEntries(g.grants.map(x => [revokedKey(x), e.target.checked])) }))} />}
            <span className="min-w-0 flex-1"><span className={ENT}>{name(g.userId)}</span><span className="text-muted-foreground"> @ {g.scopeType === 'warehouse' ? whShort(g.scopeId) : 'mọi kho'}</span> · <span className={NUM}>{g.grants.length}</span> ô
              <span className="block text-xs">{g.grants.map(x => LEGACY_LABEL[x.code]).join(', ')}</span>
              <span className="block text-xs text-muted-foreground">{g.verdict === 'covered' ? `Đã nằm trong Thủ kho ${whShort(g.scopeId)}.` : g.grants.some(x => x.code === 'wms.inventory.edit') ? 'Sửa tồn trực tiếp không còn dùng — tồn chỉ đổi qua phiếu.' : 'Chưa thuộc việc nào. Cho làm Thủ kho, hoặc gỡ.'}</span>
              {g.verdict === 'loose' && canEdit && g.scopeType === 'warehouse' && <button type="button" className="mt-1 rounded-lg border border-border px-2 py-0.5 text-xs font-semibold"
                onClick={() => { set(a => ({ ...a, keepers: { ...a.keepers, [g.scopeId]: [...new Set([...(a.keepers[g.scopeId] || []), g.userId])] } })); setRevoke(r => [...r, ...g.grants]); }}>Cho làm Thủ kho {whShort(g.scopeId)}</button>}</span>
            <Badge className={g.verdict === 'loose' ? WARN : GREY}>{g.verdict === 'covered' ? 'đã nằm trong Thủ kho' : 'chưa thuộc việc nào'}</Badge></li>; })}</ul>}
      {canEdit && openGroups.length > 0 && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-2">
        <button type="button" className={secondaryBtn} onClick={() => { const chosen = openGroups.flatMap(g => g.grants.filter(x => pick[revokedKey(x)] ?? g.verdict === 'covered')); setRevoke(r => [...r, ...chosen.filter(x => !r.some(y => revokedKey(y) === revokedKey(x)))]); }}>
          <Trash2 size={14} />Gỡ các ô đã chọn</button></div>}
    </section>}

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm"><p className="flex items-center gap-1 text-sm font-bold"><History size={14} />Nhật ký phân quyền kho</p>
      {data.log.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Chưa có lần lưu nào.</p>
        : <ul className="mt-2 space-y-2 text-xs">{data.log.map((l, i) => <li key={i}><b className={ENT}>{l.by || '—'}</b> · {dateVi(l.at)}<ul className="ml-4 list-disc text-muted-foreground">{(l.lines || []).map((x, j) => <li key={j}>{x}</li>)}</ul></li>)}</ul>}</section>

    {canEdit && <div className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-card px-4 py-2.5 shadow-lg dark:border-teal-900">
      <span className="mr-auto w-full text-sm sm:w-auto sm:flex-1">{diff.length ? <><b className={NUM}>{diff.length}</b> thay đổi chưa lưu <button type="button" className="ml-1 text-xs font-semibold text-teal-700 dark:text-teal-300" onClick={() => setAsk(true)}>xem</button></> : 'Không có thay đổi.'}</span>
      <button type="button" className={secondaryBtn} disabled={!diff.length || saving} onClick={() => { setCur(base); setRevoke([]); }}>Bỏ thay đổi</button>
      <button type="button" className={primaryBtn} disabled={!diff.length || saving} onClick={() => setAsk(true)}>Lưu</button>
    </div>}
    {ask && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 px-4" role="dialog" aria-modal="true" aria-label="Lưu phân quyền kho"><div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-2xl">
      <h2 className="text-lg font-bold">Lưu phân quyền kho?</h2><p className={`mt-1 ${ENT}`}>{diff.length} thay đổi</p>
      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-3 text-sm">{diff.map((x, i) => <li key={i} className={x.startsWith('−') ? 'text-rose-700 dark:text-rose-300' : 'text-leaf-800 dark:text-leaf-200'}>{x}</li>)}</ul>
      <p className={`mt-3 rounded-xl border px-3 py-2 text-xs ${WARN}`}>Có hiệu lực ngay; người được đổi đăng nhập lại để thấy đúng. Cấp mã / Duyệt ngoại lệ / Kế toán kho tự kèm Xem mọi kho. Nhật ký ghi ai, lúc nào, thêm / gỡ gì.</p>
      <div className="mt-4 flex justify-end gap-2"><button type="button" className={secondaryBtn} onClick={() => setAsk(false)} disabled={saving}>Không</button>
        <button type="button" className={primaryBtn} onClick={() => void save()} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</button></div>
    </div></div>}
    {person && <PersonDrawer id={person} data={data} cur={cur} base={base} canEdit={canEdit} set={set} onClose={() => setPerson(null)} say={say} />}
  </div>;
};
