import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, Bot, Check, ChevronDown, Coins, Cpu, Newspaper, RefreshCcw, Settings, Eye, EyeOff, Layers, Loader2, Plus, Search, Settings2, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../components/procurement/hub/hubUi';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { ENT, Kpi } from '../components/finance/financeUi';
import AiActivityPanel from '../components/aiCenter/AiActivityPanel';
import AiDigestPanel from '../components/aiCenter/AiDigestPanel';
import AiSkillsPanel from '../components/aiCenter/AiSkillsPanel';
import { aiSkillCatalogService, type AiSkillCatalogService } from '../lib/aiSkillCatalog';
import {
  aiAdminService, modelLabel, usd, usedPct, type AiAdminOverview, type AiConnectionRow, type AiAdminService, type AiGrant, type AiGrantValues, type AiPerson, type AiTemplate, type SkillAccess,
} from '../lib/aiAdmin';

// Trung tâm AI (chủ SP chốt 18/10/2026, thay màn /ai cũ): Quản trị AI cấp AI tới từng người — mẫu cấp phát rồi chỉnh riêng:
// model, trần tiền / tháng, số câu / ngày, skill. Skill "chỉ người được cấp" (Trợ lý) chặn ở cổng AI; skill "mọi người" như cũ.
// Người không phải Admin vào đây thấy lời mời dùng Trợ lý trong Trung tâm điều hành.

type Load<T> = T | 'loading' | 'error' | 'denied';
type Tab = 'people' | 'activity' | 'digest' | 'templates' | 'models' | 'skills';
const TABS: readonly Tab[] = ['people', 'activity', 'digest', 'templates', 'models', 'skills'];
const nf = new Intl.NumberFormat('vi-VN');
const EMPTY_GRANT: AiGrantValues = { enabled: true, templateId: null, connectionId: null, extraConnectionIds: null, monthlyCostCapUsd: null, dailyQuestionCap: null, skills: null, note: '' };
const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? null : Number(v.replace(',', '.')));

const Meter: React.FC<{ pct: number | null; label: string }> = ({ pct, label }) => (
  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
    <span className={`block h-full rounded-full ${pct == null ? 'bg-transparent' : pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-leaf-500'}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
  </span>
);


const Switch: React.FC<{ on: boolean; label: string; busy?: boolean; onChange: () => void }> = ({ on, label, busy, onChange }) => (
  // Vùng chạm do nút (≥ 44 px trên màn cảm ứng), phần hiển thị là rãnh 44 × 24 bên trong.
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} disabled={busy}
    className="inline-flex shrink-0 items-center justify-center rounded-full bg-transparent disabled:opacity-60">
    <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? 'bg-leaf-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

/** Dòng tóm tắt cấp phát hiệu lực: "Claude · $3/tháng · 30 câu/ngày · Trợ lý". */
const effectiveLine = (data: AiAdminOverview, v: { connectionId: string | null; extraConnectionIds?: string[]; monthlyCostCapUsd: number | null; dailyQuestionCap: number | null; skills: string[] }) => {
  const extra = (v.extraConnectionIds || []).filter(id => id !== v.connectionId).map(id => modelLabel(data.connections.find(c => c.id === id)));
  const skills = v.skills.map(code => data.skills.find(s => s.code === code)?.name || code);
  return [`${v.connectionId ? modelLabel(data.connections.find(c => c.id === v.connectionId)) : 'Model mặc định'}${extra.length ? ` (+ ${extra.join(', ')})` : ''}`, v.monthlyCostCapUsd != null ? `${usd(v.monthlyCostCapUsd)}/tháng` : 'không trần tháng',
    v.dailyQuestionCap != null ? `${v.dailyQuestionCap} câu/ngày` : 'không trần ngày', skills.length ? skills.join(', ') : 'chưa có skill'].join(' · ');
};

/** Chọn model THÊM (ngoài model mặc định) — người dùng được chọn ở ô hỏi. locked = theo mẫu (không sửa). */
const ModelChips: React.FC<{ label: string; data: AiAdminOverview; exclude: string | null; picked: string[]; locked?: boolean; onLock?: (lock: boolean) => void; onChange: (ids: string[]) => void }> =
  ({ label, data, exclude, picked, locked = false, onLock, onChange }) => (
  <fieldset className="sm:col-span-3">
    <legend className="text-xs font-semibold text-muted-foreground">{label}
      {onLock && <label className="ml-3 inline-flex items-center gap-1.5 font-normal"><input type="checkbox" checked={!locked} onChange={e => onLock(!e.target.checked)} /> Chọn riêng</label>}</legend>
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {data.connections.filter(c => c.enabled && c.id !== exclude).map(c => {
        const on = picked.includes(c.id);
        return <button key={c.id} type="button" aria-pressed={on} disabled={locked} onClick={() => onChange(on ? picked.filter(x => x !== c.id) : [...picked, c.id])}
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold disabled:cursor-default ${on ? 'border-leaf-300 bg-leaf-50 text-leaf-800' : 'border-border text-muted-foreground'}`}>
          {c.icon ? `${c.icon} ` : ''}{modelLabel(c)}</button>;
      })}
      {data.connections.filter(c => c.enabled && c.id !== exclude).length === 0 && <span className="text-xs text-muted-foreground">Chưa có model khác — thêm ở Cài đặt → Kết nối.</span>}
    </div>
  </fieldset>
);

// ── Ngăn cấp / sửa AI cho người ─────────────────────────────────────────────────────────────────────────────────────────
const GrantDrawer: React.FC<{ data: AiAdminOverview; service: AiAdminService; editing: AiGrant | null; onClose: () => void; onSaved: () => void }> = ({ data, service, editing, onClose, onSaved }) => {
  const toast = useToast();
  const [values, setValues] = useState<AiGrantValues>(() => editing
    ? { enabled: editing.enabled, templateId: editing.templateId, connectionId: editing.connectionId, extraConnectionIds: editing.extraConnectionIds, monthlyCostCapUsd: editing.monthlyCostCapUsd,
      dailyQuestionCap: editing.dailyQuestionCap, skills: editing.skills, note: editing.note }
    : { ...EMPTY_GRANT, templateId: data.templates[0]?.id ?? null });
  const [custom, setCustom] = useState(() => Boolean(editing && (editing.connectionId || editing.extraConnectionIds || editing.monthlyCostCapUsd != null || editing.dailyQuestionCap != null || editing.skills)));
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<AiPerson[] | 'loading' | 'error'>('loading');
  const [picked, setPicked] = useState<AiPerson[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = data.templates.find(t => t.id === values.templateId) || null;
  const set = (patch: Partial<AiGrantValues>) => setValues(v => ({ ...v, ...patch }));

  useEffect(() => {
    if (editing) return;
    let alive = true;
    setPeople('loading');
    const timer = setTimeout(() => { service.people(query).then(list => { if (alive) setPeople(list); }, () => { if (alive) setPeople('error'); }); }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, editing, service]);

  const effective = {
    connectionId: values.connectionId ?? template?.connectionId ?? null,
    extraConnectionIds: values.extraConnectionIds ?? template?.extraConnectionIds ?? [],
    monthlyCostCapUsd: values.monthlyCostCapUsd ?? template?.monthlyCostCapUsd ?? null,
    dailyQuestionCap: values.dailyQuestionCap ?? template?.dailyQuestionCap ?? null,
    skills: values.skills ?? template?.skills ?? [],
  };
  const userIds = editing ? [editing.userId] : picked.map(p => p.id);
  const save = async () => {
    if (!userIds.length) { setError('Chọn ít nhất một người.'); return; }
    if (!values.templateId && !effective.skills.length) { setError('Chọn mẫu, hoặc chỉnh riêng và chọn skill.'); return; }
    setSaving(true); setError(null);
    try {
      await service.saveGrants(userIds, custom ? values : { ...values, connectionId: null, extraConnectionIds: null, monthlyCostCapUsd: null, dailyQuestionCap: null, skills: null });
      toast.success(editing ? `Đã lưu cấp phát của ${editing.name}` : `Đã cấp AI cho ${userIds.length} người`);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được.'); } finally { setSaving(false); }
  };

  return (
    <Drawer label={editing ? `Sửa cấp AI · ${editing.name}` : 'Cấp AI'} onClose={onClose}
      header={<><h2 className="text-lg font-bold text-foreground">{editing ? editing.name : 'Cấp AI cho người dùng'}</h2>
        <p className="text-sm text-muted-foreground">{editing ? editing.email : 'Chọn người, chọn mẫu — chỉnh riêng nếu cần'}</p></>}
      footer={<>
        {error && <p className="mr-auto text-sm font-semibold text-rose-600" role="alert">{error}</p>}
        <button type="button" className={secondaryBtn} onClick={onClose}>Hủy</button>
        <button type="button" className={primaryBtn} onClick={() => void save()} disabled={saving || !userIds.length}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {editing ? 'Lưu' : `Cấp cho ${userIds.length || ''} người`.replace('  ', ' ')}</button>
      </>}>
      {!editing && (
        <section aria-label="Người dùng" className="space-y-2">
          <h3 className="text-sm font-bold text-foreground">Người dùng</h3>
          {picked.length > 0 && <div className="flex flex-wrap gap-1.5">{picked.map(p => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-leaf-200 bg-leaf-50 px-2.5 py-1 text-xs font-semibold text-leaf-800">
              {p.name}<button type="button" aria-label={`Bỏ ${p.name}`} className="ml-0.5 text-leaf-700 hover:text-rose-600" onClick={() => setPicked(list => list.filter(x => x.id !== p.id))}>×</button></span>))}</div>}
          <label className="relative block"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className={`${inputCls} w-full py-2 pl-8`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm theo tên hoặc email" aria-label="Tìm người" /></label>
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border" aria-label="Kết quả tìm người">
            {people === 'loading' && <li className="px-3 py-3 text-sm text-muted-foreground" role="status">Đang tìm…</li>}
            {people === 'error' && <li className="px-3 py-3 text-sm text-rose-600" role="alert">Chưa tìm được — thử lại.</li>}
            {Array.isArray(people) && people.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Không thấy ai khớp.</li>}
            {Array.isArray(people) && people.map(p => {
              const on = picked.some(x => x.id === p.id);
              return <li key={p.id}><button type="button" aria-pressed={on} onClick={() => setPicked(list => (on ? list.filter(x => x.id !== p.id) : [...list, p]))}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted ${on ? 'bg-leaf-50 dark:bg-leaf-900/20' : ''}`}>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${on ? 'border-leaf-600 bg-leaf-600 text-white' : 'border-border'}`}>{on && <Check size={13} />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-foreground">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.email}</span></span>
                {p.granted && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground" title="Lưu sẽ thay cấp phát cũ">Đã cấp</span>}
              </button></li>;
            })}
          </ul>
        </section>
      )}

      {editing && (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
          <span><span className="block text-sm font-bold text-foreground">Được dùng AI</span><span className="block text-xs text-muted-foreground">Tắt là chặn ngay, giữ lại cấp phát để bật lại</span></span>
          <Switch on={values.enabled} label="Được dùng AI" onChange={() => set({ enabled: !values.enabled })} />
        </label>
      )}

      <section aria-label="Mẫu cấp phát" className="space-y-2">
        <h3 className="text-sm font-bold text-foreground">Mẫu cấp phát</h3>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Chọn mẫu">
          {data.templates.map(t => (
            <button key={t.id} type="button" role="radio" aria-checked={values.templateId === t.id} onClick={() => set({ templateId: t.id })}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${values.templateId === t.id ? 'border-leaf-500 bg-leaf-50 ring-2 ring-leaf-500/30 dark:bg-leaf-900/20' : 'border-border hover:bg-muted'}`}>
              <span className="block text-sm font-bold text-foreground">{t.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{effectiveLine(data, t)}</span>
            </button>
          ))}
        </div>
      </section>

      <details className="rounded-xl border border-border" open={custom} onToggle={e => setCustom((e.target as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-bold text-foreground">
          <span className="flex items-center gap-2"><Settings2 size={15} className="text-teal-600" /> Chỉnh riêng (đè lên mẫu)</span><ChevronDown size={16} className="text-muted-foreground" />
        </summary>
        <div className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-muted-foreground sm:col-span-3">Model mặc định
            <select className={`${inputCls} mt-1 block w-full`} value={values.connectionId || ''} onChange={e => set({ connectionId: e.target.value || null })} aria-label="Model riêng">
              <option value="">Theo mẫu{template ? ` (${template.connectionId ? modelLabel(data.connections.find(c => c.id === template.connectionId)) : 'mặc định'})` : ''}</option>
              {data.connections.filter(c => c.enabled).map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{modelLabel(c)} · {c.model}{c.pricePerCall != null ? ` · ${usd(c.pricePerCall)}/lượt` : ''}</option>)}
            </select></label>
          <ModelChips label="Model thêm (người dùng chọn ở ô hỏi)" data={data} exclude={effective.connectionId} picked={effective.extraConnectionIds}
            locked={values.extraConnectionIds == null} onLock={on => set({ extraConnectionIds: on ? null : [...(template?.extraConnectionIds || [])] })}
            onChange={ids => set({ extraConnectionIds: ids })} />
          <label className="text-xs font-semibold text-muted-foreground">Trần tiền / tháng (USD)
            <input className={`${inputCls} mt-1 block w-full`} inputMode="decimal" value={values.monthlyCostCapUsd ?? ''} onChange={e => set({ monthlyCostCapUsd: numOrNull(e.target.value) })}
              placeholder={template?.monthlyCostCapUsd != null ? `Theo mẫu: ${template.monthlyCostCapUsd}` : 'Không trần'} aria-label="Trần tiền tháng riêng" /></label>
          <label className="text-xs font-semibold text-muted-foreground">Số câu / ngày
            <input className={`${inputCls} mt-1 block w-full`} inputMode="numeric" value={values.dailyQuestionCap ?? ''} onChange={e => set({ dailyQuestionCap: numOrNull(e.target.value) })}
              placeholder={template?.dailyQuestionCap != null ? `Theo mẫu: ${template.dailyQuestionCap}` : 'Không trần'} aria-label="Số câu một ngày riêng" /></label>
          <fieldset className="sm:col-span-3">
            <legend className="text-xs font-semibold text-muted-foreground">Skill
              <label className="ml-3 inline-flex items-center gap-1.5 font-normal"><input type="checkbox" checked={values.skills != null}
                onChange={e => set({ skills: e.target.checked ? [...(template?.skills || [])] : null })} /> Chọn riêng</label></legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {data.skills.filter(s => s.access === 'granted' || (values.skills ?? template?.skills ?? []).includes(s.code)).map(s => {
                const on = effective.skills.includes(s.code);
                return <button key={s.code} type="button" aria-pressed={on} disabled={values.skills == null}
                  onClick={() => set({ skills: on ? (values.skills || []).filter(x => x !== s.code) : [...(values.skills || []), s.code] })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold disabled:cursor-default ${on ? 'border-leaf-300 bg-leaf-50 text-leaf-800' : 'border-border text-muted-foreground'}`}>{s.name}</button>;
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Chỉ skill "chỉ người được cấp" mới cần chọn ở đây — đổi ở tab Skill.</p>
          </fieldset>
        </div>
      </details>

      <label className="block text-xs font-semibold text-muted-foreground">Ghi chú
        <input className={`${inputCls} mt-1 block w-full`} value={values.note} maxLength={300} onChange={e => set({ note: e.target.value })} placeholder="VD: Mua hàng SMB, thử 2 tuần" aria-label="Ghi chú" /></label>

      <p className="rounded-xl bg-muted px-3 py-2 text-sm text-foreground" aria-live="polite"><b>Hiệu lực:</b> {effectiveLine(data, custom ? effective : { ...effective,
        connectionId: template?.connectionId ?? null, extraConnectionIds: template?.extraConnectionIds ?? [], monthlyCostCapUsd: template?.monthlyCostCapUsd ?? null, dailyQuestionCap: template?.dailyQuestionCap ?? null, skills: template?.skills ?? [] })}</p>
    </Drawer>
  );
};

// ── Ngăn mẫu cấp phát ──────────────────────────────────────────────────────────────────────────────────────────────────
const TemplateDrawer: React.FC<{ data: AiAdminOverview; service: AiAdminService; editing: AiTemplate | null; onClose: () => void; onSaved: () => void }> = ({ data, service, editing, onClose, onSaved }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [t, setT] = useState(() => editing ? { ...editing } : { name: '', connectionId: data.connections.find(c => c.enabled)?.id ?? null, extraConnectionIds: [] as string[], monthlyCostCapUsd: 3, dailyQuestionCap: 30, skills: ['assistant_chat'], note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!t.name.trim()) { setError('Đặt tên mẫu.'); return; }
    setBusy(true); setError(null);
    try { await service.saveTemplate({ ...t, id: editing?.id }); toast.success(`Đã lưu mẫu ${t.name.trim()}`); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được.'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!editing || !await confirm({ title: 'Xóa mẫu cấp phát?', targetName: editing.name, intent: 'danger', actionLabel: 'Xóa mẫu' })) return;
    setBusy(true); setError(null);
    try { await service.deleteTemplate(editing.id); toast.success(`Đã xóa mẫu ${editing.name}`); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chưa xóa được.'); } finally { setBusy(false); }
  };
  return (
    <Drawer label={editing ? `Sửa mẫu ${editing.name}` : 'Mẫu cấp phát mới'} onClose={onClose}
      header={<><h2 className="text-lg font-bold text-foreground">{editing ? `Mẫu ${editing.name}` : 'Mẫu cấp phát mới'}</h2>
        <p className="text-sm text-muted-foreground">{editing ? `${editing.users} người đang dùng — đổi mẫu là đổi cho cả nhóm` : 'Một bộ model + trần + skill để cấp nhanh nhiều người'}</p></>}
      footer={<>
        {error && <p className="mr-auto text-sm font-semibold text-rose-600" role="alert">{error}</p>}
        {editing && <button type="button" className={`${secondaryBtn} text-rose-600`} onClick={() => void remove()} disabled={busy || editing.users > 0}
          title={editing.users > 0 ? 'Đổi mẫu cho những người đang dùng trước' : undefined}>Xóa mẫu</button>}
        <button type="button" className={secondaryBtn} onClick={onClose}>Hủy</button>
        <button type="button" className={primaryBtn} onClick={() => void save()} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Lưu mẫu</button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">Tên mẫu
          <input className={`${inputCls} mt-1 block w-full`} value={t.name} maxLength={80} onChange={e => setT({ ...t, name: e.target.value })} placeholder="VD: Mua hàng, Chỉ huy trưởng" aria-label="Tên mẫu" /></label>
        <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">Model mặc định
          <select className={`${inputCls} mt-1 block w-full`} value={t.connectionId || ''} onChange={e => setT({ ...t, connectionId: e.target.value || null })} aria-label="Model của mẫu">
            <option value="">Mặc định (Cài đặt → Kết nối · Trợ lý)</option>
            {data.connections.filter(c => c.enabled || c.id === t.connectionId).map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{modelLabel(c)} · {c.model}{c.pricePerCall != null ? ` · ${usd(c.pricePerCall)}/lượt` : ''}</option>)}
          </select></label>
        <div className="sm:col-span-2"><ModelChips label="Model thêm (người dùng chọn ở ô hỏi)" data={data} exclude={t.connectionId} picked={t.extraConnectionIds}
          onChange={ids => setT({ ...t, extraConnectionIds: ids })} /></div>
        <label className="text-xs font-semibold text-muted-foreground">Trần tiền / tháng (USD)
          <input className={`${inputCls} mt-1 block w-full`} inputMode="decimal" value={t.monthlyCostCapUsd ?? ''} onChange={e => setT({ ...t, monthlyCostCapUsd: numOrNull(e.target.value) })} placeholder="Không trần" aria-label="Trần tiền tháng" /></label>
        <label className="text-xs font-semibold text-muted-foreground">Số câu / ngày
          <input className={`${inputCls} mt-1 block w-full`} inputMode="numeric" value={t.dailyQuestionCap ?? ''} onChange={e => setT({ ...t, dailyQuestionCap: numOrNull(e.target.value) })} placeholder="Không trần" aria-label="Số câu một ngày" /></label>
        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-semibold text-muted-foreground">Skill được dùng</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {data.skills.map(s => {
              const on = t.skills.includes(s.code);
              return <button key={s.code} type="button" aria-pressed={on} onClick={() => setT({ ...t, skills: on ? t.skills.filter(x => x !== s.code) : [...t.skills, s.code] })}
                title={s.access === 'everyone' ? 'Skill này đang cho mọi người — chọn ở đây chỉ có tác dụng khi chuyển sang "chỉ người được cấp"' : undefined}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? 'border-leaf-300 bg-leaf-50 text-leaf-800' : 'border-border text-muted-foreground'} ${s.access === 'everyone' ? 'opacity-70' : ''}`}>
                {s.access === 'granted' && <ShieldCheck size={11} className="mr-1 inline" aria-hidden="true" />}{s.name}</button>;
            })}
          </div>
        </fieldset>
        <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">Ghi chú
          <input className={`${inputCls} mt-1 block w-full`} value={t.note} maxLength={300} onChange={e => setT({ ...t, note: e.target.value })} aria-label="Ghi chú mẫu" /></label>
      </div>
    </Drawer>
  );
};

/** Một model: tên người dùng thấy ở ô hỏi, biểu tượng, mô tả ngắn, đọc ảnh. Khóa / giá ở Cài đặt → Kết nối. */
const ModelCard: React.FC<{ model: AiConnectionRow; service: AiAdminService; onSaved: () => void }> = ({ model, service, onSaved }) => {
  const toast = useToast();
  const [m, setM] = useState({ displayName: model.displayName, blurb: model.blurb, icon: model.icon, vision: model.vision });
  const [busy, setBusy] = useState(false);
  const dirty = m.displayName !== model.displayName || m.blurb !== model.blurb || m.icon !== model.icon || m.vision !== model.vision;
  const save = async () => {
    setBusy(true);
    try { await service.saveModel({ id: model.id, ...m }); toast.success(`Đã lưu ${m.displayName || model.model}`); onSaved(); }
    catch (e) { toast.error('Chưa lưu được', e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <article className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${model.enabled ? '' : 'opacity-60'}`} aria-label={`Model ${model.displayName || model.model}`}>
      <div className="flex items-start gap-3">
        <input className={`${inputCls} h-11 w-12 text-center text-xl`} value={m.icon} maxLength={4} onChange={e => setM({ ...m, icon: e.target.value })} aria-label={`Biểu tượng ${model.model}`} placeholder="🤖" />
        <div className="min-w-0 flex-1">
          <input className={`${inputCls} w-full font-semibold`} value={m.displayName} maxLength={60} onChange={e => setM({ ...m, displayName: e.target.value })} aria-label={`Tên hiển thị ${model.model}`} placeholder={model.model} />
          <p className="mt-1 truncate text-xs text-muted-foreground">{model.name} · {model.model}{model.pricePerCall != null ? ` · ${usd(model.pricePerCall)}/lượt` : ''}{model.enabled ? '' : ' · đang tắt'}</p>
        </div>
      </div>
      <input className={`${inputCls} mt-2 w-full`} value={m.blurb} maxLength={140} onChange={e => setM({ ...m, blurb: e.target.value })} aria-label={`Mô tả ${model.model}`} placeholder="Mô tả ngắn người dùng thấy khi chọn model" />
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" aria-pressed={m.vision} onClick={() => setM({ ...m, vision: !m.vision })}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${m.vision ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-border text-muted-foreground'}`}>
          {m.vision ? <Eye size={13} /> : <EyeOff size={13} />} {m.vision ? 'Đọc được ảnh / PDF scan' : 'Không đọc ảnh'}</button>
        <button type="button" className={primaryBtn} onClick={() => void save()} disabled={!dirty || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Lưu</button>
      </div>
    </article>
  );
};

// ── Trang ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const AiCenter: React.FC<{ service?: AiAdminService; skillService?: AiSkillCatalogService }> = ({ service = aiAdminService, skillService = aiSkillCatalogService }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<Load<AiAdminOverview>>('loading');
  const [error, setError] = useState('');
  // ?tab=digest từ thông báo bản tin tuần (B4) mở đúng tab.
  const [tab, setTab] = useState<Tab>(() => { const t = searchParams.get('tab'); return t && (TABS as readonly string[]).includes(t) ? t as Tab : 'people'; });
  const [filter, setFilter] = useState('');
  const [grantDrawer, setGrantDrawer] = useState<{ editing: AiGrant | null } | null>(null);
  const [templateDrawer, setTemplateDrawer] = useState<{ editing: AiTemplate | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    service.overview().then(setData, e => {
      const message = e instanceof Error ? e.message : String(e);
      setError(message); setData(/Quản trị AI|ADMIN/.test(message) ? 'denied' : 'error');
    });
  }, [service]);
  useEffect(() => { load(); }, [load]);

  const grants = useMemo(() => {
    if (typeof data !== 'object') return [];
    const q = filter.trim().toLowerCase();
    return q ? data.grants.filter(g => `${g.name} ${g.email}`.toLowerCase().includes(q)) : data.grants;
  }, [data, filter]);

  if (data === 'loading') return <div className="mx-auto max-w-6xl p-4 md:p-6"><StateBox kind="loading" /></div>;
  if (data === 'denied') {
    return <div className="mx-auto max-w-xl p-4 md:p-6">
      <StateBox kind="denied" title="Trung tâm AI dành cho Quản trị AI" message="Để hỏi đáp, gửi ảnh / Excel, lập phiếu nháp — dùng Trợ lý trong Trung tâm điều hành." />
      <div className="mt-4 text-center"><button type="button" className={primaryBtn} onClick={() => navigate('/center')}><Sparkles size={15} /> Mở Trợ lý</button></div>
    </div>;
  }
  if (data === 'error') return <div className="mx-auto max-w-6xl p-4 md:p-6"><StateBox kind="error" message={error} onRetry={() => { setData('loading'); load(); }} /></div>;

  const enabledCount = data.grants.filter(g => g.enabled).length;
  const capPct = usedPct(data.month.costUsd, data.settings.monthlyCostCapUsd);
  const toggle = async (g: AiGrant) => {
    setBusy(g.userId);
    try {
      await service.saveGrants([g.userId], { enabled: !g.enabled, templateId: g.templateId, connectionId: g.connectionId, extraConnectionIds: g.extraConnectionIds, monthlyCostCapUsd: g.monthlyCostCapUsd,
        dailyQuestionCap: g.dailyQuestionCap, skills: g.skills, note: g.note });
      toast.success(g.enabled ? `Đã tắt AI của ${g.name}` : `Đã bật AI cho ${g.name}`);
      load();
    } catch (e) { toast.error('Chưa đổi được', e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const setAccess = async (code: string, name: string, access: SkillAccess) => {
    const ok = await confirm(access === 'granted'
      ? { title: 'Chỉ cho người được cấp?', targetName: name, warningText: 'Người chưa được cấp skill này sẽ bị chặn ngay ở mọi màn đang dùng.', intent: 'warning', actionLabel: 'Đổi' }
      : { title: 'Mở cho mọi người?', targetName: name, warningText: 'Ai có quyền vào màn nghiệp vụ là dùng được skill này.', intent: 'warning', actionLabel: 'Đổi' });
    if (!ok) return;
    setBusy(code);
    try { await service.setSkillAccess(code, access); toast.success(`Đã đổi: ${name}`); load(); }
    catch (e) { toast.error('Chưa đổi được', e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const connName = (id: string | null) => modelLabel(data.connections.find(x => x.id === id));
  const modelsText = (ids: string[], fallback: string | null) => (ids.length ? ids : fallback ? [fallback] : []).map(connName).join(' · ') || 'Mặc định';

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-700 text-white"><Bot size={22} /></span>
          <div><h1 className="text-xl font-bold text-foreground md:text-2xl">Trung tâm AI</h1><p className="text-sm text-muted-foreground">Cấp AI tới từng người, theo dõi dùng và chi phí</p></div>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <a href="#/settings?tab=ai-gateway" className={`${secondaryBtn} flex-1 md:flex-none`} title="Bật tắt AI, trần chung, khóa model, lượt gần nhất"><Settings size={15} /> Cổng AI</a>
          <button type="button" className={`${secondaryBtn} flex-1 md:flex-none`} onClick={() => { setData('loading'); load(); }}><RefreshCcw size={15} /> Làm mới</button>
          <button type="button" className={`${primaryBtn} flex-1 md:flex-none`} onClick={() => { setTab('people'); setGrantDrawer({ editing: null }); }}><Plus size={16} /> Cấp AI</button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi active={tab === 'people'} onClick={() => setTab('people')} icon={Users} tone="text-leaf-600" label="Người được dùng" value={`${enabledCount}`}
          hint={data.grants.length - enabledCount ? `${data.grants.length - enabledCount} đang tắt` : 'đang bật hết'} />
        <Kpi active={tab === 'activity'} onClick={() => setTab('activity')} icon={Coins} tone={capPct != null && capPct >= 80 ? 'text-rose-600' : 'text-sky-600'} label="Chi phí tháng này"
          value={usd(data.month.costUsd)} hint={`${capPct != null ? `${capPct}% ` : ''}trần chung ${usd(data.settings.monthlyCostCapUsd)}`} />
        <Kpi active={false} onClick={() => setTab('activity')} icon={Activity} tone="text-teal-600" label="Lượt AI tháng này" value={nf.format(data.month.runs)}
          hint={data.settings.monthlyRunCap ? `trần ${nf.format(data.settings.monthlyRunCap)} lượt` : 'không trần lượt'} />
        <Kpi active={tab === 'templates'} onClick={() => setTab('templates')} icon={Layers} tone="text-mint-600" label="Mẫu cấp phát" value={`${data.templates.length}`}
          hint={data.templates.map(t => t.name).join(' · ') || 'Chưa có'} />
      </div>

      <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Trung tâm AI">
        {([['people', 'Người dùng', Users, data.grants.length], ['activity', 'Hoạt động', Activity, null], ['digest', 'Bản tin tuần', Newspaper, null], ['templates', 'Mẫu cấp phát', Layers, data.templates.length], ['models', 'Model', Cpu, data.connections.length], ['skills', 'Skill', Sparkles, data.skills.length]] as const).map(([key, label, Icon, n]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === key ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            <Icon size={15} /> {label} {n != null && <span className={`text-xs font-medium ${tab === key ? 'text-teal-100' : 'text-muted-foreground'}`}>{n}</span>}</button>
        ))}
      </div>

      {tab === 'people' && (
        <section role="tabpanel" aria-label="Người dùng" className="space-y-3">
          {data.grants.length > 6 && <label className="relative block max-w-sm"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className={`${inputCls} w-full py-2 pl-8`} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Lọc theo tên, email" aria-label="Lọc người dùng" /></label>}
          {data.grants.length === 0 ? <StateBox kind="empty" title="Chưa cấp AI cho ai" message="Bấm Cấp AI, chọn người và mẫu — người được cấp dùng Trợ lý ngay." /> : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Danh sách được cấp">
              {grants.map(g => {
                const e = g.effective;
                const dayPct = usedPct(g.usage.today, e.dailyQuestionCap);
                const monthPct = usedPct(g.usage.monthCostUsd, e.monthlyCostCapUsd);
                return (
                  <li key={g.userId} className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center ${g.enabled ? '' : 'opacity-60'}`} aria-label={g.name}>
                    <div className="min-w-0">
                      <p className={`truncate ${ENT}`}>{g.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{g.email}{g.note ? ` · ${g.note}` : ''}</p>
                    </div>
                    <div className="min-w-0 text-sm">
                      <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200">{e.templateName || 'Riêng'}</span>
                      {(g.connectionId || g.extraConnectionIds || g.monthlyCostCapUsd != null || g.dailyQuestionCap != null || g.skills) && <span className="ml-1.5 text-[11px] font-semibold text-amber-700" title="Có chỉnh riêng đè lên mẫu">chỉnh riêng</span>}
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" title="Model được chọn ở ô hỏi (mặc định đứng đầu)">{modelsText(e.models, e.connectionId)}</p>
                    </div>
                    <div className="text-xs">
                      <p className="flex justify-between gap-2 text-muted-foreground"><span>Hôm nay</span><b className="tabular-nums text-foreground">{g.usage.today}{e.dailyQuestionCap != null ? `/${e.dailyQuestionCap}` : ''} câu</b></p>
                      <Meter pct={dayPct} label={`Câu hôm nay của ${g.name}`} />
                    </div>
                    <div className="text-xs">
                      <p className="flex justify-between gap-2 text-muted-foreground"><span>Tháng</span><b className="tabular-nums text-foreground">{usd(g.usage.monthCostUsd)}{e.monthlyCostCapUsd != null ? ` / ${usd(e.monthlyCostCapUsd)}` : ''}</b></p>
                      <Meter pct={monthPct} label={`Chi phí tháng của ${g.name}`} />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Switch on={g.enabled} busy={busy === g.userId} label={`${g.enabled ? 'Tắt' : 'Bật'} AI của ${g.name}`} onChange={() => void toggle(g)} />
                      <button type="button" className={secondaryBtn} onClick={() => setGrantDrawer({ editing: g })} aria-label={`Sửa cấp phát của ${g.name}`}>Sửa</button>
                    </div>
                  </li>
                );
              })}
              {grants.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Không thấy ai khớp bộ lọc.</li>}
            </ul>
          )}
        </section>
      )}

      {tab === 'activity' && <div role="tabpanel" aria-label="Hoạt động"><AiActivityPanel load={service.activity} /></div>}
      {tab === 'digest' && <AiDigestPanel list={service.digests} run={service.runDigest} onOpenRoute={route => navigate(route)} confirm={o => confirm({ title: o.title, targetName: o.targetName, warningText: o.message, actionLabel: o.confirmText, intent: 'warning', countdownSeconds: 0 })} notify={(text, kind) => (kind === 'error' ? toast.error(text) : toast.success(text))} />}

      {tab === 'templates' && (
        <section role="tabpanel" aria-label="Mẫu cấp phát" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.templates.map(t => (
            <article key={t.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm" aria-label={`Mẫu ${t.name}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-foreground">{t.name}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{t.users} người</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Model</dt><dd className="truncate text-right font-semibold text-foreground" title={[t.connectionId, ...t.extraConnectionIds].filter(Boolean).map(id => connName(id as string)).join(' · ')}>
                  {connName(t.connectionId)}{t.extraConnectionIds.filter(id => id !== t.connectionId).length ? ` +${t.extraConnectionIds.filter(id => id !== t.connectionId).length}` : ''}</dd>
                <dt className="text-muted-foreground">Trần tháng</dt><dd className="text-right font-semibold tabular-nums text-foreground">{t.monthlyCostCapUsd != null ? usd(t.monthlyCostCapUsd) : 'Không'}</dd>
                <dt className="text-muted-foreground">Câu / ngày</dt><dd className="text-right font-semibold tabular-nums text-foreground">{t.dailyQuestionCap ?? 'Không'}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1">{t.skills.map(code => <span key={code} className="rounded-full border border-leaf-200 bg-leaf-50 px-2 py-0.5 text-[11px] font-semibold text-leaf-800">{data.skills.find(s => s.code === code)?.name || code}</span>)}</div>
              {t.note && <p className="mt-2 text-xs text-muted-foreground">{t.note}</p>}
              <button type="button" className={`${secondaryBtn} mt-auto self-start`} style={{ marginTop: 12 }} onClick={() => setTemplateDrawer({ editing: t })} aria-label={`Sửa mẫu ${t.name}`}>Sửa mẫu</button>
            </article>
          ))}
          <button type="button" onClick={() => setTemplateDrawer({ editing: null })}
            className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-sm font-semibold text-muted-foreground hover:border-leaf-400 hover:text-leaf-700">
            <Plus size={20} /> Mẫu mới</button>
        </section>
      )}

      {tab === 'models' && (
        <section role="tabpanel" aria-label="Model" className="grid gap-3 md:grid-cols-2">
          {data.connections.map(c => <ModelCard key={c.id} model={c} service={service} onSaved={load} />)}
          <a href="#/settings?tab=connections" className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border px-4 text-center text-sm font-semibold text-muted-foreground hover:border-leaf-400 hover:text-leaf-700">
            <Plus size={20} /> Thêm model mới<span className="text-xs font-normal">Khóa API, giá ở Cài đặt → Kết nối</span></a>
        </section>
      )}

      {tab === 'skills' && <AiSkillsPanel skills={data.skills} busy={busy} onSetAccess={(code, name, access) => void setAccess(code, name, access)} service={skillService} />}

      {grantDrawer && <GrantDrawer data={data} service={service} editing={grantDrawer.editing} onClose={() => setGrantDrawer(null)} onSaved={() => { setGrantDrawer(null); load(); }} />}
      {templateDrawer && <TemplateDrawer data={data} service={service} editing={templateDrawer.editing} onClose={() => setTemplateDrawer(null)} onSaved={() => { setTemplateDrawer(null); load(); }} />}
    </div>
  );
};

export default AiCenter;
