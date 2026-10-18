import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Link2, Loader2, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../components/procurement/hub/hubUi';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  FEATURES, PRESETS, integrationError, integrationsService, kindLabel, kindLabelFull, presetOf, priceLabel, testedAtLabel,
  type Connection, type ConnectionDraft, type ConnectionFeature, type ConnectionKind, type EnvConnection, type ProbeResult,
} from '../../lib/integrationsService';

// Cài đặt → Kết nối (Admin, chủ SP 16/10): danh sách kết nối API nhà cung cấp, thử kết nối, gán cho tính năng.
// Khóa chỉ nhập vào, không bao giờ hiện lại (4 ký tự cuối). Khóa trong Secrets hiện "chỉ đọc", thử được.

type Row = { key: string; name: string; kind: ConnectionKind; model: string | null; keyHint: string | null; tone: 'ok' | 'error' | 'idle';
  statusText: string; usedBy: string[]; connection?: Connection; env?: EnvConnection };

const DOT: Record<Row['tone'], string> = { ok: 'bg-leaf-500', error: 'bg-rose-500', idle: 'bg-slate-300 dark:bg-slate-600' };
const STATUS_TEXT: Record<Row['tone'], string> = { ok: 'text-leaf-700 dark:text-leaf-300', error: 'text-rose-700 dark:text-rose-300', idle: 'text-muted-foreground' };

const probeLine = (r: ProbeResult) => r.ok
  ? `${r.code === 'MODEL_NOT_FOUND' ? r.message : 'Kết nối được'} · ${r.ms} ms${r.models != null ? ` · ${r.models} model` : ''}${r.balance ? ` · còn ${r.balance.amount.toLocaleString('vi-VN')} ${r.balance.unit}` : ''}`
  : `${r.httpStatus ? `Lỗi ${r.httpStatus} — ` : ''}${r.message}`;

const emptyDraft = (): ConnectionDraft => ({ kind: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: '', model: 'gemini-2.5-flash', enabled: true, priceIn: '', priceOut: '', pricePerCall: '' });
const priceInput = (v: number | null) => (v == null ? '' : String(v).replace('.', ','));

const ConnectionEditor: React.FC<{
  initial: Connection | null;
  onClose: () => void;
  onSaved: (c: Connection) => void;
  onDeleted: (id: string) => void;
}> = ({ initial, onClose, onSaved, onDeleted }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<ConnectionDraft>(() => initial
    ? { id: initial.id, kind: initial.kind, name: initial.name, baseUrl: initial.baseUrl, apiKey: '', model: initial.model || '', enabled: initial.enabled,
      priceIn: priceInput(initial.priceInPerM), priceOut: priceInput(initial.priceOutPerM), pricePerCall: priceInput(initial.pricePerCall) }
    : emptyDraft());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [testError, setTestError] = useState('');
  const [saving, setSaving] = useState(false);
  const [presetId, setPresetId] = useState(() => (initial ? presetOf(initial.kind, initial.baseUrl) : PRESETS.find(p => p.id === 'gemini')!).id);
  const opt = PRESETS.find(p => p.id === presetId)!;
  const set = (patch: Partial<ConnectionDraft>) => { setDraft(d => ({ ...d, ...patch })); setResult(null); setTestError(''); };
  const changePreset = (id: string) => {
    const next = PRESETS.find(p => p.id === id)!;
    const prev = opt;
    setPresetId(id);
    set({ kind: next.kind, baseUrl: !draft.baseUrl || draft.baseUrl === prev.baseUrl ? next.baseUrl : draft.baseUrl,
      name: !draft.name || draft.name === prev.name || draft.name === kindLabel(prev.kind) ? next.name : draft.name,
      model: !draft.model || draft.model === prev.modelHint ? (next.id === next.kind ? '' : next.modelHint) : draft.model });
  };
  const needsKey = !initial || draft.baseUrl.trim().replace(/\/+$/, '') !== initial.baseUrl;
  const canTest = draft.baseUrl.trim().startsWith('https://') && (draft.apiKey.trim() || !needsKey);
  const canSave = draft.name.trim() && draft.baseUrl.trim().startsWith('https://') && (draft.apiKey.trim() || (!!initial && !needsKey));

  const test = async () => {
    setTesting(true); setResult(null); setTestError('');
    try {
      const r = await integrationsService.test({ draft: { kind: draft.kind, baseUrl: draft.baseUrl, apiKey: draft.apiKey, model: draft.model }, connectionId: initial?.id });
      setResult(r.result);
    } catch (e) { setTestError(integrationError(e, 'Chưa thử được.')); }
    finally { setTesting(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      let saved = await integrationsService.save(draft);
      // Lưu xong thử luôn bằng khóa trong Vault để danh sách có trạng thái thật.
      try { const r = await integrationsService.test({ connectionId: saved.id }); if (r.connection) saved = r.connection; } catch { /* vẫn lưu; trạng thái "Chưa thử" */ }
      toast.success(initial ? 'Đã lưu kết nối' : 'Đã thêm kết nối', saved.name);
      onSaved(saved);
    } catch (e) { toast.error('Chưa lưu được kết nối', integrationError(e)); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!initial) return;
    const ok = await confirm({ title: 'Xóa kết nối?', targetName: initial.name, warningText: 'Khóa trong Vault bị xóa theo. Tính năng đang gán sẽ quay về khóa trong Secrets.', actionLabel: 'Xóa', intent: 'danger' });
    if (!ok) return;
    try { await integrationsService.remove(initial.id); toast.success('Đã xóa kết nối', initial.name); onDeleted(initial.id); }
    catch (e) { toast.error('Chưa xóa được', integrationError(e)); }
  };

  const label = 'block text-xs font-semibold text-muted-foreground';
  return (
    <Drawer label={initial ? `Sửa kết nối ${initial.name}` : 'Thêm kết nối'} onClose={onClose}
      header={<h2 className="text-lg font-bold text-foreground">{initial ? `Sửa kết nối · ${initial.name}` : 'Thêm kết nối'}</h2>}
      footer={<>
        {initial && <button type="button" onClick={remove} className={`${secondaryBtn} mr-auto text-rose-700`}><Trash2 size={15} />Xóa</button>}
        <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
        <button type="button" onClick={save} disabled={!canSave || saving} className={primaryBtn} title={canSave ? undefined : 'Nhập tên, endpoint https:// và API key'}>
          {saving && <Loader2 size={15} className="animate-spin" />}Lưu
        </button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Loại
          <select value={presetId} onChange={e => changePreset(e.target.value)} className={`${inputCls} mt-1 block w-full`} aria-label="Loại kết nối">
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className={label}>Tên
          <input value={draft.name} onChange={e => set({ name: e.target.value })} maxLength={80} className={`${inputCls} mt-1 block w-full`} aria-label="Tên kết nối" />
        </label>
        <label className={`${label} sm:col-span-2`}>Endpoint
          <input value={draft.baseUrl} onChange={e => set({ baseUrl: e.target.value })} placeholder="https://…" className={`${inputCls} mt-1 block w-full font-mono`} aria-label="Endpoint" spellCheck={false} />
        </label>
        <label className={`${label} sm:col-span-2`}>API key
          <input type="password" autoComplete="new-password" value={draft.apiKey} onChange={e => set({ apiKey: e.target.value })} spellCheck={false}
            placeholder={initial?.keyHint ? `•••• ${initial.keyHint}${needsKey ? ' — đổi endpoint thì nhập lại khóa' : ' — để trống nếu giữ khóa cũ'}` : opt.keyHint}
            className={`${inputCls} mt-1 block w-full font-mono`} aria-label="API key" />
        </label>
        <label className={label}>Model
          <input value={draft.model} onChange={e => set({ model: e.target.value })} list="connection-models" placeholder={opt.modelHint} spellCheck={false}
            className={`${inputCls} mt-1 block w-full font-mono`} aria-label="Model" />
          <datalist id="connection-models">{(result?.modelIds || []).map(id => <option key={id} value={id} />)}</datalist>
        </label>
        {/* Giá để tính chi phí từng lượt AI và trần tháng (Cài đặt → Cổng AI); nhà cung cấp tính VND thì chia tỷ giá (RevidAPI ÷ 26.000). */}
        <label className={label} title="Để tính chi phí từng lượt AI và trần tháng. Nhà cung cấp tính VND thì chia tỷ giá, VD RevidAPI ÷ 26.000.">Giá vào · USD / 1 triệu token
          <input value={draft.priceIn} onChange={e => set({ priceIn: e.target.value })} inputMode="decimal" placeholder="VD 0,33" spellCheck={false}
            className={`${inputCls} mt-1 block w-full font-mono`} aria-label="Giá vào (USD / 1 triệu token)" />
        </label>
        <label className={label} title="Để tính chi phí từng lượt AI và trần tháng.">Giá ra · USD / 1 triệu token
          <input value={draft.priceOut} onChange={e => set({ priceOut: e.target.value })} inputMode="decimal" placeholder="VD 1,64" spellCheck={false}
            className={`${inputCls} mt-1 block w-full font-mono`} aria-label="Giá ra (USD / 1 triệu token)" />
        </label>
        <label className={label} title="Cổng báo số token vào không ổn định (VD RevidAPI) thì khai giá mỗi lượt gọi model: chi phí = số lượt × giá lượt + token ra × giá ra, bỏ giá vào.">Giá mỗi lượt gọi · USD
          <input value={draft.pricePerCall} onChange={e => set({ pricePerCall: e.target.value })} inputMode="decimal" placeholder="VD 0,008 (để trống nếu tính theo token)" spellCheck={false}
            className={`${inputCls} mt-1 block w-full font-mono`} aria-label="Giá mỗi lượt gọi (USD)" />
        </label>
        {initial && (
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm font-semibold">
            <input type="checkbox" checked={draft.enabled} onChange={e => set({ enabled: e.target.checked })} className="h-4 w-4 accent-teal-700" />Đang bật
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <button type="button" onClick={test} disabled={!canTest || testing} className={`${secondaryBtn} bg-card`} title={canTest ? undefined : 'Nhập endpoint https:// và API key'}>
          {testing ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}Kiểm tra kết nối
        </button>
        {result && <span data-testid="draft-result" className={`text-sm font-semibold ${result.ok && result.code !== 'MODEL_NOT_FOUND' ? 'text-leaf-700 dark:text-leaf-300' : result.ok ? 'text-amber-700' : 'text-rose-700'}`}>{probeLine(result)}</span>}
        {testError && <span className="text-sm font-semibold text-rose-700">{testError}</span>}
        {!result && !testError && !testing && <span className="text-xs text-muted-foreground">Đọc danh sách model, không tốn lượt AI.</span>}
      </div>
    </Drawer>
  );
};

const SettingsConnections: React.FC = () => {
  const toast = useToast();
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [assignments, setAssignments] = useState<Record<ConnectionFeature, string | null>>({ 'ai.fast': null, 'ai.reasoning': null, 'wms.doc_reader': null, 'ai.assistant': null });
  const [envs, setEnvs] = useState<EnvConnection[] | null>(null);
  const [envResults, setEnvResults] = useState<Record<string, ProbeResult | 'testing' | undefined>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Connection | 'new' | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await integrationsService.list();
      setConnections(r.connections); setAssignments(r.assignments); setState('ready');
    } catch (e) {
      setError(integrationError(e, 'Không tải được.'));
      setState((e as { code?: string })?.code === '42501' ? 'denied' : 'error');
      return;
    }
    integrationsService.envConnections().then(setEnvs).catch(() => setEnvs([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const testSaved = async (c: Connection) => {
    setTestingId(c.id);
    try {
      const r = await integrationsService.test({ connectionId: c.id });
      if (r.connection) setConnections(cur => cur.map(x => x.id === c.id ? r.connection! : x));
      toast[r.result.ok ? 'success' : 'error'](c.name, probeLine(r.result));
    } catch (e) { toast.error('Chưa thử được', integrationError(e)); }
    finally { setTestingId(null); }
  };
  const testEnv = async (env: EnvConnection) => {
    setEnvResults(cur => ({ ...cur, [env.id]: 'testing' }));
    try { const r = await integrationsService.test({ envId: env.id }); setEnvResults(cur => ({ ...cur, [env.id]: r.result })); }
    catch (e) { setEnvResults(cur => ({ ...cur, [env.id]: undefined })); toast.error('Chưa thử được', integrationError(e)); }
  };
  const assign = async (feature: ConnectionFeature, connectionId: string | null) => {
    const before = assignments[feature];
    setAssignments(cur => ({ ...cur, [feature]: connectionId }));
    try { await integrationsService.assign(feature, connectionId); toast.success('Đã gán', FEATURES.find(f => f.feature === feature)?.label); }
    catch (e) { setAssignments(cur => ({ ...cur, [feature]: before })); toast.error('Chưa gán được', integrationError(e)); }
  };

  const usedBy = (id: string) => FEATURES.filter(f => assignments[f.feature] === id).map(f => f.label);
  const rows: Row[] = [
    ...connections.map(c => {
      const tested = testedAtLabel(c.lastTestedAt);
      const tone: Row['tone'] = !c.enabled ? 'idle' : c.status === 'ok' ? 'ok' : c.status === 'error' ? 'error' : 'idle';
      const statusText = !c.enabled ? 'Đang tắt'
        : c.status === 'ok' ? `Đang chạy${tested ? ` · thử ${tested}` : ''}`
          : c.status === 'error' ? `${c.lastTest.httpStatus ? `Lỗi ${c.lastTest.httpStatus}` : 'Lỗi'}${c.lastTest.message ? ` — ${c.lastTest.message}` : ''}${tested ? ` · thử ${tested}` : ''}` : 'Chưa thử';
      return { key: c.id, name: c.name, kind: c.kind, model: c.model, keyHint: c.keyHint, tone, statusText, usedBy: usedBy(c.id), connection: c };
    }),
    ...(envs || []).map(e => {
      const r = envResults[e.id];
      const tone: Row['tone'] = r && r !== 'testing' ? (r.ok ? 'ok' : 'error') : 'idle';
      const statusText = r === 'testing' ? 'Đang thử…' : r ? probeLine(r) : 'Chưa thử';
      return { key: e.id, name: e.name, kind: e.kind, model: e.model || null, keyHint: e.keyHint, tone, statusText, usedBy: [], env: e };
    }),
  ];
  const enabledConnections = connections.filter(c => c.enabled);

  return (
    <div className="space-y-4" data-testid="connections">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><Link2 size={22} /></div>
          <div>
            <h2 className="text-xl font-bold text-foreground md:text-2xl">Kết nối</h2>
            <p className="text-sm text-muted-foreground">API nhà cung cấp AI: endpoint, khóa, thử kết nối, gán cho tính năng.</p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button type="button" onClick={() => setEditing('new')} disabled={state !== 'ready'} className={`${primaryBtn} flex-1 sm:flex-none`}><Plus size={15} />Thêm kết nối</button>
          <button type="button" onClick={load} disabled={state === 'loading'} className={`${secondaryBtn} bg-card`} aria-label="Làm mới" title="Làm mới">
            <RefreshCcw size={15} className={state === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {state === 'loading' && connections.length === 0 && <StateBox kind="loading" title="Đang tải…" />}
      {state === 'denied' && <StateBox kind="denied" title="Chỉ Admin quản lý kết nối" />}
      {state === 'error' && <StateBox kind="error" title="Không tải được kết nối" message={error} onRetry={load} />}

      {state === 'ready' && (
        <>
          <section className="rounded-2xl border border-border bg-card shadow-sm" aria-label="Danh sách kết nối">
            {rows.length === 0 && envs !== null
              ? <StateBox kind="empty" title="Chưa có kết nối nào" message="Bấm Thêm kết nối để nhập endpoint và API key." />
              : <ul className="divide-y divide-border/70">
                {rows.map(row => {
                  const busy = row.connection ? testingId === row.connection.id : envResults[row.key] === 'testing';
                  return (
                    <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3" data-testid="connection-row">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[row.tone]}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-bold text-foreground">{row.name}</span>
                          <span className="text-xs text-muted-foreground">AI · {row.model || kindLabel(row.kind)}{row.connection && priceLabel(row.connection) ? ` · ${priceLabel(row.connection)}` : ''}</span>
                          {row.env && <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" title="Khóa đặt trong Supabase Secrets — sửa ở trang quản trị Supabase">Secrets · chỉ đọc</span>}
                        </div>
                        <p className="m-0 text-xs text-muted-foreground">
                          {row.usedBy.length ? <>Dùng cho: <b className="text-foreground">{row.usedBy.join(', ')}</b> · </> : null}
                          khóa •••• {row.keyHint || '—'}
                        </p>
                      </div>
                      <span className={`basis-full text-xs font-semibold sm:basis-auto sm:text-right ${STATUS_TEXT[row.tone]}`} data-testid="connection-status">{row.statusText}</span>
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => (row.connection ? testSaved(row.connection) : testEnv(row.env!))} className={`${secondaryBtn} bg-card py-1.5`} aria-label={`Thử ${row.name}`}>
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}Thử
                        </button>
                        {row.connection && <button type="button" onClick={() => setEditing(row.connection!)} className={`${secondaryBtn} bg-card py-1.5`} aria-label={`Sửa ${row.name}`}>Sửa</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>}
          </section>

          <section className="rounded-2xl border border-border bg-card shadow-sm" aria-label="Dùng cho">
            <header className="border-b border-border px-4 py-3"><h3 className="text-sm font-bold text-foreground">Dùng cho</h3></header>
            <ul className="divide-y divide-border/70">
              {FEATURES.map(f => {
                const chosen = connections.find(c => c.id === assignments[f.feature]);
                return (
                  <li key={f.feature} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="text-sm font-medium text-foreground">{f.label}</span>
                    <div className="flex items-center gap-2">
                      {chosen && chosen.status === 'error' && <span className="text-xs font-semibold text-rose-700">kết nối đang lỗi</span>}
                      <select value={assignments[f.feature] || ''} onChange={e => assign(f.feature, e.target.value || null)} className={`${inputCls} min-w-56`} aria-label={f.label}>
                        <option value="">{f.emptyLabel || 'Khóa trong Secrets (mặc định)'}</option>
                        {enabledConnections.map(c => <option key={c.id} value={c.id}>{c.name} · {kindLabelFull(c.kind)}</option>)}
                        {chosen && !chosen.enabled && <option value={chosen.id}>{chosen.name} (đang tắt)</option>}
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {editing && (
        <ConnectionEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={saved => { setConnections(cur => cur.some(c => c.id === saved.id) ? cur.map(c => c.id === saved.id ? saved : c) : [...cur, saved]); setEditing(null); }}
          onDeleted={id => { setConnections(cur => cur.filter(c => c.id !== id)); setAssignments(cur => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v === id ? null : v])) as typeof cur); setEditing(null); }}
        />
      )}
    </div>
  );
};

export default SettingsConnections;
