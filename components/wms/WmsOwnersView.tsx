import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Hash, History, Info, Lock, Plus, RefreshCw, ShieldCheck, UserPlus, Warehouse, X } from 'lucide-react';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { foldVi, ownersErrorMessage, ownersFromGrants, wmsOwnersService, type WmsOwnersAssign, type WmsOwnersData } from '../../lib/wmsCatalogService';
import { GREY, TEAL, WARN, dateVi } from './wmsUi';

// Kho vật tư → Người phụ trách (V1-2): 4 việc theo ô quyền. Ai xem được kho đều xem; chỉ Admin sửa. Lưu một lần, có nhật ký.

type Duty = 'code' | 'exception' | 'accounting';
const DUTY: Record<Duty, { label: string; icon: React.ElementType; does: string[]; perm: string }> = {
  code: { label: 'Cấp mã', icon: Hash, perm: 'Danh mục kho → Cấp mã', does: ['Cấp mã mới, xử lý đề xuất mã', 'Sửa mã, ngừng dùng / mở lại', 'Đặt cách quản lý kho'] },
  exception: { label: 'Duyệt ngoại lệ', icon: ShieldCheck, perm: 'Giao dịch kho → Duyệt ngoại lệ', does: ['Duyệt xuất hủy / hao hụt', 'Duyệt phiếu điều chỉnh', 'Duyệt chênh lệch kiểm kê', 'Không tự duyệt phiếu mình lập'] },
  accounting: { label: 'Kế toán kho', icon: Lock, perm: 'Kế toán kho → Kế toán kho', does: ['Bổ sung giá hàng nhập chưa có giá', 'Đảo phiếu đã ghi sổ (có lý do)', 'Kết xuất MISA', 'Khóa kỳ tháng (người được chọn)'] },
};
const KEEPER_DOES = ['Nhập kho, nhận hàng đợt giao', 'Xuất kho, chốt tiêu hao', 'Gửi / nhận chuyển kho', 'Lập phiếu xuất hủy (người Duyệt ngoại lệ duyệt)', 'Đếm kiểm kê'];
const OPS: Record<string, string> = { 'wms.transaction.create': 'Tạo phiếu', 'wms.transaction.approve': 'Duyệt phiếu', 'wms.transaction.complete': 'Hoàn tất phiếu', 'wms.inventory.edit': 'Sửa tồn' };
const ROLE_VI: Record<string, string> = { ADMIN: 'Admin', WAREHOUSE_KEEPER: 'Tài khoản kho (cũ)', EMPLOYEE: 'Nhân viên' };

const Does: React.FC<{ items: string[] }> = ({ items }) => {
  const [open, setOpen] = useState(false);
  return <div><button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300"><Info size={12} />Làm được gì<ChevronDown size={12} className={open ? 'rotate-180' : ''} /></button>
    {open && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{items.map(x => <li key={x}>{x}</li>)}</ul>}</div>;
};

const People: React.FC<{ ids: string[]; was: string[]; canEdit: boolean; label: string; users: WmsOwnersData['users']; onChange: (ids: string[]) => void }> = ({ ids, was, canEdit, label, users, onChange }) => {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const name = (id: string) => users.find(u => u.id === id)?.name || id;
  const removed = was.filter(x => !ids.includes(x));
  const hits = q.trim() ? users.filter(u => !ids.includes(u.id) && foldVi(u.name).includes(foldVi(q.trim()))).slice(0, 6) : [];
  return <div className="flex flex-wrap items-center gap-1.5">
    {ids.map(id => { const add = !was.includes(id); return <span key={id} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm ${add ? 'border-leaf-300 bg-leaf-50 text-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-200' : 'border-mint-200 bg-mint-50 text-mint-800 dark:bg-mint-950/40 dark:text-mint-200'}`}>
      {name(id)}{add && <span className="text-[10px] font-bold uppercase">mới</span>}
      {canEdit && <button type="button" aria-label={`Bỏ ${name(id)} khỏi ${label}`} onClick={() => onChange(ids.filter(x => x !== id))} className="rounded-full p-0.5 hover:bg-white/70"><X size={12} /></button>}</span>; })}
    {removed.map(id => <span key={id} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-sm text-rose-700"><span className="line-through">{name(id)}</span>
      {canEdit && <button type="button" aria-label={`Giữ ${name(id)}`} onClick={() => onChange([...ids, id])} className="rounded-full p-0.5 hover:bg-white"><Plus size={12} /></button>}</span>)}
    {ids.length === 0 && removed.length === 0 && <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Chưa có ai</span>}
    {canEdit && <span className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-teal-400 px-2.5 py-1 text-sm font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40"><UserPlus size={13} />Thêm</button>
      {open && <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-border bg-card p-2 shadow-xl">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Gõ tên (không cần dấu)…" aria-label={`Tìm người cho ${label}`} className={`w-full ${inputCls}`} />
        <ul className="mt-1">{hits.map(u => <li key={u.id}><button type="button" onClick={() => { onChange([...ids, u.id]); setQ(''); setOpen(false); }} className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">{u.name}<span className="ml-1 text-xs text-muted-foreground">{ROLE_VI[u.role] || u.role}</span></button></li>)}
          {q.trim() && hits.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">Không thấy</li>}</ul></div>}
    </span>}
  </div>;
};


export const WmsOwnersView: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<WmsOwnersData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [base, setBase] = useState<WmsOwnersAssign | null>(null);
  const [cur, setCur] = useState<WmsOwnersAssign | null>(null);
  const [view, setView] = useState<'wh' | 'people'>('wh');
  const [person, setPerson] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState(s => (s === 'ready' ? s : 'loading'));
    try { const d = await wmsOwnersService.get(); const a = ownersFromGrants(d); const { globalKeepers: _g, ...assign } = a; setData(d); setBase(assign); setCur(assign); setState('ready'); }
    catch (e) { setMessage(ownersErrorMessage(e, 'Chưa tải được người phụ trách kho.')); setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const globalKeepers = useMemo(() => (data ? ownersFromGrants(data).globalKeepers : []), [data]);
  const name = (id: string | null) => (id && data?.users.find(u => u.id === id)?.name) || '—';
  const whName = (id: string) => data?.warehouses.find(w => w.id === id)?.name || id;
  const diff = useMemo(() => {
    if (!data || !base || !cur) return [] as string[];
    const out: string[] = [];
    const cmp = (label: string, was: string[], now: string[]) => { now.filter(x => !was.includes(x)).forEach(x => out.push(`+ ${name(x)} — ${label}`)); was.filter(x => !now.includes(x)).forEach(x => out.push(`− ${name(x)} — ${label}`)); };
    data.warehouses.forEach(w => cmp(`Thủ kho ${w.name}`, base.keepers[w.id] || [], cur.keepers[w.id] || []));
    (Object.keys(DUTY) as Duty[]).forEach(k => cmp(DUTY[k].label, base[k], cur[k]));
    if (cur.closer !== base.closer) out.push(`Người khóa kỳ: ${name(cur.closer)}`);
    if (out.length) globalKeepers.forEach(id => out.push(`− ${name(id)} — Thủ kho mọi kho`));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, base, cur, globalKeepers]);

  if (state === 'loading' && !data) return <StateBox kind="loading" title="Đang tải người phụ trách kho…" />;
  if (state === 'error' && !data) return <StateBox kind={/quyền/.test(message) ? 'denied' : 'error'} title="Chưa mở được Người phụ trách" message={message} onRetry={() => void load()} />;
  if (!data || !base || !cur) return null;
  const canEdit = data.can.edit;
  const act: Record<string, Record<string, number>> = {};
  data.activity.forEach(a => { (act[a.warehouseId] ||= {})[a.userId] = a.n; });
  const keeperOf = (wh: string, id: string) => (cur.keepers[wh] || []).includes(id);
  const loose = data.warehouses.flatMap(w => [...new Set(data.grants.filter(g => OPS[g.code] && g.scopeType === 'warehouse' && g.scopeId === w.id).map(g => g.userId))]
    .filter(id => !keeperOf(w.id, id)).map(id => ({ wh: w.id, id, codes: data.grants.filter(g => g.userId === id && g.scopeId === w.id && OPS[g.code]).map(g => OPS[g.code]) })));
  const looseGlobal = [...new Set(data.grants.filter(g => OPS[g.code] && g.scopeType === 'global').map(g => g.userId))];
  const legacy = data.users.filter(u => u.role === 'WAREHOUSE_KEEPER');
  const sod: string[] = [];
  data.warehouses.forEach(w => (cur.keepers[w.id] || []).forEach(id => {
    if (cur.closer === id) sod.push(`${name(id)} là thủ kho ${w.name} và người khóa kỳ → khi khóa, tồn ${w.name} phải được người Duyệt ngoại lệ hoặc Admin xác nhận trước.`);
    if (cur.exception.includes(id)) sod.push(`${name(id)} là thủ kho ${w.name} và Duyệt ngoại lệ → không tự duyệt phiếu ngoại lệ do mình lập.`);
  }));
  const peopleIds = [...new Set([...Object.values(cur.keepers).flat(), ...Object.values(base.keepers).flat(), ...cur.code, ...cur.exception, ...cur.accounting,
    ...base.code, ...base.exception, ...base.accounting, ...legacy.map(u => u.id), ...globalKeepers])].sort((a, b) => name(a).localeCompare(name(b), 'vi'));
  const save = async () => {
    setSaving(true);
    try { const r = await wmsOwnersService.save(cur); toast.success('Đã lưu người phụ trách kho', `Thêm ${r.added}, gỡ ${r.removed} quyền. Có hiệu lực ngay.`); setAsk(false); await load(); }
    catch (e) { toast.error('Chưa lưu được', ownersErrorMessage(e)); }
    finally { setSaving(false); }
  };

  return <div className="space-y-3 pb-20">
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl bg-muted p-1" role="tablist" aria-label="Cách xem">{([['wh', 'Theo kho & việc'], ['people', 'Theo người']] as const).map(([k, l]) =>
        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-card text-teal-800 shadow-sm dark:text-teal-200' : 'text-muted-foreground'}`}>{l}</button>)}</div>
      <p className="mr-auto text-xs text-muted-foreground">{canEdit ? 'Xanh lá = sẽ thêm · gạch đỏ = sẽ gỡ. Lưu một lần, có nhật ký.' : 'Bạn đang xem — chỉ Admin sửa.'} Cũng thấy ở Cài đặt → Người dùng → nhóm Kho vật tư.</p>
      <button type="button" className={`${secondaryBtn} bg-card`} onClick={() => void load()}><RefreshCw size={15} />Làm mới</button>
    </div>

    {view === 'wh' ? <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="space-y-3">
        {data.warehouses.map(w => { const actList = Object.entries(act[w.id] || {}).sort((a, b) => b[1] - a[1]); const lz = loose.filter(x => x.wh === w.id);
          return <article key={w.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white"><Warehouse size={16} /></span>
              <div className="min-w-0 flex-1"><h2 className={ENT}>{w.name}</h2><p className="text-xs text-muted-foreground">{w.project || (w.type === 'GENERAL' ? 'kho tổng' : w.type === 'OFFICE' ? 'kho văn phòng' : '')}</p></div><Does items={KEEPER_DOES} /></div>
            <p className="mb-1.5 mt-3 text-xs font-semibold text-muted-foreground">Thủ kho</p>
            <People label={`thủ kho ${w.name}`} users={data.users} ids={cur.keepers[w.id] || []} was={base.keepers[w.id] || []} canEdit={canEdit}
              onChange={ids => setCur(c => c && ({ ...c, keepers: { ...c.keepers, [w.id]: ids } }))} />
            {actList.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Người lập phiếu 60 ngày qua: {actList.map(([u, n]) => <span key={u} className="mr-2"><span className={ENT}>{name(u)}</span> <span className={NUM}>{n}</span></span>)}</p>}
            {lz.length > 0 && <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${WARN}`}><p className="font-semibold"><AlertTriangle size={12} className="mr-1 inline" />Quyền lẻ ở kho này (sửa ở Cài đặt → Người dùng)</p>
              <ul className="mt-1 space-y-0.5">{lz.map(x => <li key={x.id}><b>{name(x.id)}</b>: {x.codes.join(', ')}</li>)}</ul></div>}
          </article>; })}
      </section>
      <section className="space-y-3">
        {(Object.keys(DUTY) as Duty[]).map(k => { const D = DUTY[k]; return <article key={k} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white"><D.icon size={16} /></span>
            <div className="flex-1"><h2 className="font-bold">{D.label} <span className="text-xs font-normal text-muted-foreground">toàn công ty</span></h2><p className="text-[11px] text-muted-foreground">Ô quyền: {D.perm}</p></div><Does items={D.does} /></div>
          <div className="mt-2"><People label={D.label} users={data.users} ids={cur[k]} was={base[k]} canEdit={canEdit} onChange={ids => setCur(c => c && ({ ...c, [k]: ids, ...(k === 'accounting' && c.closer && !ids.includes(c.closer) ? { closer: null } : {}) }))} /></div>
          {k === 'exception' && <p className="mt-2 text-xs text-muted-foreground">Admin luôn có quyền này.</p>}
          {k === 'accounting' && <label className="mt-3 block text-sm font-medium">Người khóa kỳ tháng
            <select disabled={!canEdit} value={cur.closer || ''} onChange={e => setCur(c => c && ({ ...c, closer: e.target.value || null }))} className={`mt-1 w-full ${inputCls}`}><option value="">Chưa chọn</option>{cur.accounting.map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>}
        </article>; })}
        {sod.length > 0 && <div className={`rounded-2xl border px-4 py-3 text-sm ${WARN}`}><p className="font-semibold"><AlertTriangle size={14} className="mr-1 inline" />Tách nhiệm — hệ thống tự chặn khi thao tác</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{sod.map(s => <li key={s}>{s}</li>)}</ul></div>}
        {(looseGlobal.length > 0 || globalKeepers.length > 0) && <div className={`rounded-2xl border px-4 py-3 text-xs ${GREY}`}><p className="font-semibold">Quyền đang cấp cho “mọi kho”</p>
          <ul className="mt-1 space-y-0.5">{globalKeepers.map(id => <li key={`k${id}`}><b>{name(id)}</b>: Thủ kho mọi kho — gỡ khi lưu</li>)}
            {looseGlobal.map(id => <li key={id}><b>{name(id)}</b>: {[...new Set(data.grants.filter(g => g.userId === id && g.scopeType === 'global' && OPS[g.code]).map(g => OPS[g.code]))].join(', ')} — sửa ở Cài đặt → Người dùng</li>)}</ul></div>}
        <div className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground shadow-sm"><p className="font-semibold text-foreground">Người chỉ xem tồn kho</p><p className="mt-1"><span className={NUM}>{data.viewers}</span> người có quyền Xem tồn kho; quản lý ở Cài đặt → Người dùng.</p></div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><p className="flex items-center gap-1 text-sm font-bold"><History size={14} />Nhật ký phân công</p>
          {data.log.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Chưa có lần lưu nào.</p>
            : <ul className="mt-2 space-y-2 text-xs">{data.log.map((l, i) => <li key={i}><b className={ENT}>{l.by || '—'}</b> · {dateVi(l.at)}<ul className="ml-4 list-disc text-muted-foreground">{(l.lines || []).map(x => <li key={x}>{x}</li>)}</ul></li>)}</ul>}</div>
      </section>
    </div>
      : <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm"><table className="w-full min-w-[46rem] text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Người</th><th className="px-2 py-2 font-medium">Thủ kho</th>{(Object.keys(DUTY) as Duty[]).map(k => <th key={k} className="px-2 py-2 text-center font-medium">{DUTY[k].label}</th>)}<th className="px-2 py-2 font-medium">Loại tài khoản</th></tr></thead>
        <tbody>{peopleIds.map(id => { const u = data.users.find(x => x.id === id); const whs = data.warehouses.filter(w => keeperOf(w.id, id));
          return <tr key={id} onClick={() => setPerson(id)} className="cursor-pointer border-t border-border hover:bg-teal-50/40 dark:hover:bg-teal-950/20">
            <td className="px-3 py-2"><span className={ENT}>{name(id)}</span></td>
            <td className="px-2 py-2">{whs.length ? <span className="flex flex-wrap gap-1">{whs.map(w => <Badge key={w.id} className={TEAL}>{w.name.replace(/^Kho /, '')}</Badge>)}</span> : <span className="text-muted-foreground">—</span>}</td>
            {(Object.keys(DUTY) as Duty[]).map(k => <td key={k} className="px-2 py-2 text-center">{cur[k].includes(id) ? <CheckCircle2 size={16} className="inline text-leaf-600" aria-label="có" /> : <span className="text-muted-foreground">—</span>}</td>)}
            <td className="px-2 py-2 text-xs">{ROLE_VI[u?.role || ''] || u?.role || '—'}</td></tr>; })}</tbody></table>
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Bấm một người để xem{canEdit ? ' và chỉnh' : ''} từng việc.</p></div>}

    {canEdit && <div className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-card px-4 py-2.5 shadow-lg dark:border-teal-900">
      <span className="mr-auto w-full text-sm sm:w-auto sm:flex-1">{diff.length ? <><b className={NUM}>{diff.length}</b> thay đổi chưa lưu</> : 'Không có thay đổi.'}</span>
      <button type="button" className={secondaryBtn} disabled={!diff.length || saving} onClick={() => setCur(base)}>Bỏ thay đổi</button>
      <button type="button" className={primaryBtn} disabled={!diff.length || saving} onClick={() => setAsk(true)}>Lưu</button>
    </div>}
    {ask && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 px-4" role="dialog" aria-modal="true" aria-label="Lưu người phụ trách kho"><div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-2xl">
      <h2 className="text-lg font-bold">Lưu người phụ trách kho?</h2><p className={`mt-1 ${ENT}`}>{diff.length} thay đổi</p>
      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-3 text-sm">{diff.map(x => <li key={x} className={x.startsWith('−') ? 'text-rose-700 dark:text-rose-300' : 'text-leaf-800 dark:text-leaf-200'}>{x}</li>)}</ul>
      <p className={`mt-3 rounded-xl border px-3 py-2 text-xs ${WARN}`}>Có hiệu lực ngay. Quyền kho đi theo 4 việc trên; ghi nhật ký ai, lúc nào, thêm / gỡ gì.</p>
      <div className="mt-4 flex justify-end gap-2"><button type="button" className={secondaryBtn} onClick={() => setAsk(false)} disabled={saving}>Không</button>
        <button type="button" className={primaryBtn} onClick={() => void save()} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</button></div>
    </div></div>}
    {person && <Drawer label={name(person)} onClose={() => setPerson(null)}
      header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Người phụ trách kho</p><h2 className={`text-lg ${ENT}`}>{name(person)}</h2>
        <p className="text-sm text-muted-foreground">{ROLE_VI[data.users.find(u => u.id === person)?.role || ''] || ''}</p></>}
      footer={<button type="button" className={primaryBtn} onClick={() => setPerson(null)}>Xong</button>}>
      <section><h3 className="mb-1 text-sm font-bold">Thủ kho ở kho nào</h3>
        <div className="grid gap-2 sm:grid-cols-2">{data.warehouses.map(w => { const on = keeperOf(w.id, person); const was = (base.keepers[w.id] || []).includes(person);
          return <label key={w.id} className={`flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm ${on !== was ? (on ? 'ring-2 ring-leaf-300' : 'ring-2 ring-rose-200') : ''} ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
            <input type="checkbox" disabled={!canEdit} checked={on} onChange={() => setCur(c => c && ({ ...c, keepers: { ...c.keepers, [w.id]: on ? (c.keepers[w.id] || []).filter(x => x !== person) : [...(c.keepers[w.id] || []), person] } }))} />
            <span className="flex-1">{w.name}</span>{(act[w.id]?.[person] || 0) > 0 && <span className="text-xs text-muted-foreground">{act[w.id][person]} phiếu</span>}</label>; })}</div></section>
      <section><h3 className="mb-1 text-sm font-bold">Việc toàn công ty</h3>
        <div className="space-y-2">{(Object.keys(DUTY) as Duty[]).map(k => { const on = cur[k].includes(person); const was = base[k].includes(person);
          return <label key={k} className={`flex items-start gap-2 rounded-xl border border-border px-3 py-2 text-sm ${on !== was ? (on ? 'ring-2 ring-leaf-300' : 'ring-2 ring-rose-200') : ''} ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
            <input type="checkbox" className="mt-1" disabled={!canEdit} checked={on} onChange={() => setCur(c => c && ({ ...c, [k]: on ? c[k].filter(x => x !== person) : [...c[k], person], ...(k === 'accounting' && on && c.closer === person ? { closer: null } : {}) }))} />
            <span className="flex-1"><b>{DUTY[k].label}</b><span className="block text-xs text-muted-foreground">{DUTY[k].does.join(' · ')}</span></span></label>; })}</div></section>
    </Drawer>}
  </div>;
};
