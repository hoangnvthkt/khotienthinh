import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Plug, RefreshCcw, Save, Zap } from 'lucide-react';
import { StateBox, inputCls, primaryBtn, secondaryBtn } from '../../components/procurement/hub/hubUi';
import { useToast } from '../../context/ToastContext';
import {
  AI_MODE_LABELS, AI_PROVIDER_LABELS, AI_RUN_STATUS_LABELS, AI_TIER_LABELS, aiErrorMessage, aiGateway,
  type AiGatewayOverview, type AiGatewayStatus, type AiSkillRow,
} from '../../lib/aiGateway';

// Cài đặt → Cổng AI (Admin): nhà cung cấp (khóa đặt ở secrets, màn chỉ báo có / chưa), công tắc + trần tháng, skill (bật tắt, lượt/ngày,
// lớp model, người phụ trách), lượt gần nhất. Chỉ tiêu đề + số liệu; giải thích để title.
const PERIODS = [7, 30, 90];
const nf = new Intl.NumberFormat('vi-VN');
const usd = (value: number | null) => value == null ? '—' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const STATUS_TONE: Record<string, string> = {
  ok: 'border-leaf-200 bg-leaf-50 text-leaf-800', started: 'border-sky-200 bg-sky-50 text-sky-800', no_provider: 'border-slate-200 bg-slate-100 text-slate-700',
  quota: 'border-amber-200 bg-amber-50 text-amber-800', denied: 'border-amber-200 bg-amber-50 text-amber-800',
  refused: 'border-rose-200 bg-rose-50 text-rose-700', error: 'border-rose-200 bg-rose-50 text-rose-700',
};
const chip = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold';
const SKILL_SOURCE_LABEL: Record<string, string> = { AI_PROVIDER: 'AI_PROVIDER', WMS_AI_PROVIDER: 'WMS_AI_PROVIDER (dùng chung Kho)', default: 'mặc định', unknown: '' };

const Card: React.FC<{ title: string; icon: React.ElementType; right?: React.ReactNode; children: React.ReactNode }> = ({ title, icon: Icon, right, children }) =>
  <section className="rounded-2xl border border-border bg-card shadow-sm" aria-label={title}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground"><Icon size={15} className="text-teal-600" />{title}</h3>
      {right}
    </header>
    <div className="px-4 py-3">{children}</div>
  </section>;

const SettingsAiGateway: React.FC = () => {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<AiGatewayOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<AiGatewayStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [form, setForm] = useState({ enabled: true, monthlyRunCap: '3000', monthlyCostCapUsd: '50' });
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (period: number) => {
    setState('loading');
    try {
      const o = await aiGateway.overview(period);
      setOverview(o);
      setForm({ enabled: o.settings.enabled, monthlyRunCap: String(o.settings.monthlyRunCap), monthlyCostCapUsd: String(o.settings.monthlyCostCapUsd) });
      setState('ready');
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message || e));
      setState(code === '42501' ? 'denied' : 'error');
      return;
    }
    try { setStatus(await aiGateway.status()); setStatusError(''); }
    catch (e) { setStatus(null); setStatusError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(days); }, [days, load]);

  const saveSettings = async () => {
    const monthlyRunCap = Math.max(0, Math.floor(Number(form.monthlyRunCap) || 0));
    const monthlyCostCapUsd = Math.max(0, Number(form.monthlyCostCapUsd) || 0);
    setSaving(true);
    try {
      await aiGateway.setSettings({ enabled: form.enabled, monthlyRunCap, monthlyCostCapUsd });
      toast.success('Đã lưu cài đặt cổng AI');
      await load(days);
    } catch (e) { toast.error('Chưa lưu được cài đặt', e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const patchSkill = async (skill: AiSkillRow, patch: Partial<Pick<AiSkillRow, 'enabled' | 'dailyLimit' | 'modelClass'>>) => {
    setOverview(cur => cur ? { ...cur, skills: cur.skills.map(s => s.code === skill.code ? { ...s, ...patch } : s) } : cur);
    try { await aiGateway.setSkill(skill.code, patch); toast.success(`Đã lưu skill ${skill.name}`); }
    catch (e) { toast.error('Chưa lưu được skill', e instanceof Error ? e.message : String(e)); load(days); }
  };

  const runCheck = async () => {
    setChecking(true); setCheckResult(null);
    try {
      const r = await aiGateway.run<{ ok: boolean; note: string }>('gateway_check', {}, { from: 'settings' });
      setCheckResult(r.code === 'OK' ? { ok: true, text: `OK · ${r.model} · ${nf.format(r.usage.durationMs)} ms · ${r.result.note}` } : { ok: false, text: aiErrorMessage(r) });
    } catch (e) { setCheckResult({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setChecking(false); load(days); }
  };

  const month = overview?.month;
  const keys = status ? (Object.keys(status.keysPresent) as Array<keyof AiGatewayStatus['keysPresent']>).filter(k => status.keysPresent[k]) : [];

  return (
    <div className="space-y-4" data-testid="ai-gateway">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><Plug size={22} /></div>
          <div>
            <h2 className="text-xl font-bold text-foreground md:text-2xl">Cổng AI</h2>
            <p className="text-sm text-muted-foreground">Một cổng cho mọi skill AI: chạy bằng tài khoản người dùng, có nhật ký và hạn mức.</p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="flex flex-1 rounded-xl border border-border bg-card p-1 sm:flex-none" role="group" aria-label="Khoảng thời gian">
            {PERIODS.map(p => (
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold sm:flex-none ${days === p ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>{p} ngày</button>
            ))}
          </div>
          <button type="button" onClick={() => load(days)} disabled={state === 'loading'} className={`${secondaryBtn} bg-card`} title="Tải lại">
            <RefreshCcw size={15} className={state === 'loading' ? 'animate-spin' : ''} /><span className="hidden sm:inline">Làm mới</span>
          </button>
        </div>
      </div>

      {state === 'loading' && !overview && <StateBox kind="loading" title="Đang tải…" />}
      {state === 'denied' && <StateBox kind="denied" title="Chỉ Admin vào được Cổng AI" />}
      {state === 'error' && <StateBox kind="error" title="Không tải được cổng AI" message={error} onRetry={() => load(days)} />}

      {overview && state !== 'denied' && state !== 'error' && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Nhà cung cấp" icon={Zap} right={
              <button type="button" onClick={runCheck} disabled={checking || !status?.deployed} className={`${secondaryBtn} bg-card`}
                title={status?.deployed ? 'Gọi thử một câu ngắn (skill Kiểm tra kết nối)' : 'Hàm ai-gateway chưa triển khai'}>
                <Activity size={15} className={checking ? 'animate-pulse' : ''} />Thử kết nối
              </button>}>
              {statusError && <p className="text-sm font-semibold text-rose-600">Không đọc được tình trạng: {statusError}</p>}
              {status && !status.deployed && <p className="text-sm font-bold text-amber-700">Hàm ai-gateway chưa triển khai.</p>}
              {status?.deployed && (
                <div className="space-y-1 text-sm">
                  {status.configured
                    ? <p className="font-bold text-leaf-700 dark:text-leaf-300">Đang dùng {AI_PROVIDER_LABELS[status.provider]}</p>
                    : <p className="font-bold text-amber-700 dark:text-amber-300">Chưa có khóa AI — mọi skill trả về "làm tay như thường".</p>}
                  <p className="text-muted-foreground">
                    Nhà cung cấp: <b className="text-foreground">{AI_PROVIDER_LABELS[status.provider]}</b>
                    {SKILL_SOURCE_LABEL[status.providerSource] ? <span> · {SKILL_SOURCE_LABEL[status.providerSource]}</span> : null}
                  </p>
                  <p className="text-muted-foreground">Model nhanh: <b className="text-foreground">{status.models.fast || '—'}</b> · suy luận: <b className="text-foreground">{status.models.reasoning || '—'}</b></p>
                  <p className="text-muted-foreground">Khóa có sẵn trong secrets: <b className="text-foreground">{keys.length ? keys.map(k => AI_PROVIDER_LABELS[k]).join(', ') : 'chưa có'}</b></p>
                  {!status.configured && (
                    <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      Để bật: đặt <code className="font-mono">ANTHROPIC_API_KEY</code>{status.keysPresent.gemini ? <>, hoặc <code className="font-mono">AI_PROVIDER=gemini</code> để dùng khóa Gemini có sẵn</> : null} trong Supabase → Edge Functions → Secrets, rồi bấm Thử kết nối.
                    </p>
                  )}
                  {status.configured && !status.priceKnown && <p className="text-xs text-muted-foreground">Chi phí mỗi lượt sẽ hiện "—" cho tới khi đặt <code className="font-mono">AI_PRICE_IN_PER_M</code> / <code className="font-mono">AI_PRICE_OUT_PER_M</code> (USD mỗi triệu token).</p>}
                </div>
              )}
              {checkResult && <p className={`mt-2 text-sm font-semibold ${checkResult.ok ? 'text-leaf-700' : 'text-amber-700'}`} data-testid="check-result">{checkResult.text}</p>}
            </Card>

            <Card title="Công tắc và trần tháng" icon={Save}>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="h-4 w-4 accent-teal-700" />
                  Bật cổng AI
                </label>
                <label className="text-xs font-semibold text-muted-foreground">Lượt / tháng
                  <input type="number" min={0} value={form.monthlyRunCap} onChange={e => setForm(f => ({ ...f, monthlyRunCap: e.target.value }))} className={`${inputCls} mt-1 block w-28`} />
                </label>
                <label className="text-xs font-semibold text-muted-foreground">Trần USD / tháng
                  <input type="number" min={0} step="0.5" value={form.monthlyCostCapUsd} onChange={e => setForm(f => ({ ...f, monthlyCostCapUsd: e.target.value }))} className={`${inputCls} mt-1 block w-28`} />
                </label>
                <button type="button" onClick={saveSettings} disabled={saving} className={primaryBtn}><Save size={15} />Lưu</button>
              </div>
              {month && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Tháng này: <b className="text-foreground tabular-nums">{nf.format(month.runs)}</b> lượt · <b className="text-foreground tabular-nums">{nf.format(month.users)}</b> người
                  {month.errors ? <> · lỗi <b className="text-rose-700 tabular-nums">{nf.format(month.errors)}</b></> : null}
                  {month.noProvider ? <> · chưa có khóa <b className="text-amber-700 tabular-nums">{nf.format(month.noProvider)}</b></> : null}
                  {month.quota ? <> · hết lượt <b className="text-amber-700 tabular-nums">{nf.format(month.quota)}</b></> : null}
                  {' · '}chi phí <b className="text-foreground tabular-nums">{month.costKnown ? usd(month.costUsd) : '—'}</b> / trần {usd(overview.settings.monthlyCostCapUsd)}
                </p>
              )}
            </Card>
          </div>

          <Card title="Skill" icon={Plug} right={<span className="text-xs text-muted-foreground">{overview.skills.length} skill · dùng trong {overview.days} ngày</span>}>
            {overview.skills.length === 0
              ? <StateBox kind="empty" title="Chưa có skill nào" />
              : <ul className="divide-y divide-border/60">
                {overview.skills.map(s => (
                  <li key={s.code} className="py-3" data-testid="skill-row">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        <span className="font-bold text-foreground">{s.name}</span>
                        <span className={`${chip} ml-2 border-teal-200 bg-teal-50 text-teal-800`}>{AI_TIER_LABELS[s.tier] || s.tier}</span>
                        <span className={`${chip} ml-1 border-slate-200 bg-slate-100 text-slate-700`}>{AI_MODE_LABELS[s.mode] || s.mode}</span>
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{s.code}</span>
                        <p className="truncate text-xs text-muted-foreground" title={s.description}>{s.description}</p>
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        <b className="text-foreground">{nf.format(s.runs)}</b> lượt
                        {s.errors ? <> · <b className="text-rose-700">{nf.format(s.errors)}</b> lỗi</> : null}
                        {s.noProvider ? <> · {nf.format(s.noProvider)} chưa khóa</> : null}
                        {' · '}nhận {s.acceptedRate == null ? '—' : `${s.acceptedRate}%`}{s.feedbacks ? ` (${s.feedbacks})` : ''}
                        {' · '}{nf.format(s.users)} người{s.avgMs != null ? ` · ${nf.format(s.avgMs)} ms` : ''}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                      <label className="flex items-center gap-1.5 font-semibold">
                        <input type="checkbox" checked={s.enabled} onChange={e => patchSkill(s, { enabled: e.target.checked })} className="h-4 w-4 accent-teal-700" aria-label={`Bật ${s.name}`} />Bật
                      </label>
                      <label className="flex items-center gap-1.5 text-muted-foreground">Lượt / người / ngày
                        <input type="number" min={0} max={10000} defaultValue={s.dailyLimit} aria-label={`Lượt mỗi ngày ${s.name}`}
                          onBlur={e => { const v = Math.max(0, Math.min(10000, Math.floor(Number(e.target.value) || 0))); if (v !== s.dailyLimit) patchSkill(s, { dailyLimit: v }); }}
                          className={`${inputCls} w-20 py-1`} />
                      </label>
                      <label className="flex items-center gap-1.5 text-muted-foreground">Model
                        <select value={s.modelClass} onChange={e => patchSkill(s, { modelClass: e.target.value === 'reasoning' ? 'reasoning' : 'fast' })} className={`${inputCls} py-1`} aria-label={`Lớp model ${s.name}`}>
                          <option value="fast">Nhanh</option><option value="reasoning">Suy luận</option>
                        </select>
                      </label>
                      <span className="text-muted-foreground">Phụ trách: <b className={s.ownerName ? 'text-foreground' : 'text-rose-600'}>{s.ownerName || 'chưa gán'}</b></span>
                    </div>
                  </li>
                ))}
              </ul>}
          </Card>

          <Card title="Lượt gần nhất" icon={Activity} right={<span className="text-xs text-muted-foreground">{overview.recent.length} lượt</span>}>
            {overview.recent.length === 0
              ? <StateBox kind="empty" title="Chưa có lượt AI nào" message="Khi người dùng gọi skill, từng lượt hiện ở đây." />
              : <ul className="divide-y divide-border/60 text-sm">
                {overview.recent.map(r => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{when(r.createdAt)}</span>
                    {/* Điện thoại: người · skill xuống dòng riêng cho đủ tên; máy tính: cùng hàng. */}
                    <span className="order-last min-w-0 basis-full truncate sm:order-none sm:flex-1 sm:basis-auto"><b className="text-foreground">{r.userName || '—'}</b> · {overview.skills.find(s => s.code === r.skillCode)?.name || r.skillCode}</span>
                    <span className={`${chip} ${STATUS_TONE[r.status] || STATUS_TONE.error}`} title={r.error || undefined}>{AI_RUN_STATUS_LABELS[r.status] || r.status}</span>
                    <span className="ml-auto text-right tabular-nums text-xs text-muted-foreground sm:w-28">{r.durationMs != null ? `${nf.format(r.durationMs)} ms` : ''}{r.costUsd != null ? ` · ${usd(r.costUsd)}` : ''}</span>
                  </li>
                ))}
              </ul>}
          </Card>
        </>
      )}
    </div>
  );
};

export default SettingsAiGateway;
