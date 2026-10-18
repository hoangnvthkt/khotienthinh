import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquare, ThumbsDown, Wallet, Zap } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { ENT, Kpi, NUM } from '../finance/financeUi';
import { AI_FEEDBACK_REASONS } from '../../lib/aiGateway';
import { COMMAND_LABEL, TOPIC_LABEL, fillDays, usd, type AiActivity } from '../../lib/aiAdmin';

// Trung tâm AI · Hoạt động (chủ SP 18/10/2026 — mở Trợ lý cho nhóm 15 người): AI có giúp được việc thật không?
// Đọc từ trên xuống: tổng (câu hỏi, làm được việc, đánh giá, chi phí) → theo ngày → hỏi về gì → thẻ nháp → theo người → 👎 gần đây.

const PERIODS = [7, 14, 30] as const;
const nf = new Intl.NumberFormat('vi-VN');
const ddmm = (iso: string) => { const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso); return Number.isFinite(d.getTime()) ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '—'; };
const ago = (iso: string | null, now: Date) => {
  if (!iso) return 'Chưa dùng';
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  return mins < 60 ? `${Math.max(1, mins)} phút trước` : mins < 1440 ? `${Math.round(mins / 60)} giờ trước` : `${Math.round(mins / 1440)} ngày trước`;
};
const reasonLabel = (code: string | null) => AI_FEEDBACK_REASONS.find(r => r.code === code)?.label || 'Không ghi lý do';

const Card: React.FC<{ title: string; id?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, id, right, children, className = '' }) => (
  <section id={id} className={`scroll-mt-4 rounded-2xl border border-border bg-card shadow-sm ${className}`} aria-label={title}>
    <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5"><h3 className="text-sm font-bold text-foreground">{title}</h3>{right}</header>
    <div className="px-4 py-3">{children}</div>
  </section>
);

const AiActivityPanel: React.FC<{ load?: (days: number) => Promise<AiActivity>; now?: Date }> = ({ load, now = new Date() }) => {
  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<AiActivity | 'loading' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!load) return;
    let alive = true;
    setData('loading');
    load(days).then(d => { if (alive) setData(d); }, e => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setData('error'); } });
    return () => { alive = false; };
  }, [load, days, attempt]);
  const series = useMemo(() => (typeof data === 'object' ? fillDays(data.daily, data.days, now) : []), [data, now]);

  const periodPicker = (
    <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Khoảng thời gian">
      {PERIODS.map(p => <button key={p} type="button" role="radio" aria-checked={days === p} onClick={() => setDays(p)}
        className={`rounded-md px-2.5 py-1 text-xs font-semibold ${days === p ? 'bg-leaf-600 text-white' : 'text-muted-foreground hover:bg-muted'}`}>{p} ngày</button>)}
    </div>
  );
  if (!load) return <StateBox kind="empty" title="Chưa có dữ liệu hoạt động" />;
  if (data === 'loading') return <div className="space-y-3"><div className="flex justify-end">{periodPicker}</div><StateBox kind="loading" /></div>;
  if (data === 'error') return <StateBox kind="error" message={error} onRetry={() => setAttempt(n => n + 1)} />;

  const t = data.totals;
  const prepared = data.commands.reduce((n, c) => n + c.prepared, 0);
  const done = data.commands.reduce((n, c) => n + c.done, 0);
  const max = Math.max(1, ...series.map(d => d.questions));
  const topicMax = Math.max(1, ...data.topics.map(x => x.questions));
  const idle = data.people.filter(p => p.granted && p.questions === 0).length;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-3" role="region" aria-label="Hoạt động AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Từ {ddmm(series[0]?.day || '')} tới hôm nay</p>
        {periodPicker}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi active={false} onClick={() => go('act-daily')} icon={MessageSquare} tone="text-sky-600" label="Câu hỏi Trợ lý" value={nf.format(t.questions)}
          hint={`${t.askers}/${data.granted} người đã hỏi${idle ? ` · ${idle} chưa dùng` : ''}`} />
        <Kpi active={false} onClick={() => go('act-commands')} icon={Zap} tone="text-leaf-600" label="Làm được việc" value={prepared ? `${done}/${prepared}` : '—'}
          hint={prepared ? `thẻ gửi thật · ${Math.round((done / prepared) * 100)}%` : 'chưa có thẻ nháp'} />
        <Kpi active={false} onClick={() => go('act-dislikes')} icon={ThumbsDown} tone={t.dislikes ? 'text-amber-600' : 'text-mint-600'} label="Đánh giá" value={`👍 ${t.likes} · 👎 ${t.dislikes}`}
          hint={t.blocked ? `${t.blocked} lần chạm trần` : `${t.withFiles} câu có ảnh / tệp`} />
        <Kpi active={false} onClick={() => go('act-people')} icon={Wallet} tone="text-teal-600" label="Chi phí kỳ này" value={usd(t.costUsd)}
          hint={data.models.length ? `${data.models.length} model` : '—'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card id="act-daily" title="Câu hỏi theo ngày">
          <div className="flex h-40 items-end gap-1" role="img" aria-label={`Câu hỏi theo ngày: ${series.map(d => `${ddmm(d.day)} ${d.questions}`).join(', ')}`}>
            {series.map(d => (
              <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${ddmm(d.day)}: ${d.questions} câu · ${d.people} người`}>
                <span className="mb-0.5 text-center text-[10px] tabular-nums text-muted-foreground">{d.questions || ''}</span>
                <span className={`block rounded-t ${d.questions ? 'bg-leaf-500' : 'bg-muted'}`} style={{ height: `${Math.max(3, (d.questions / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{ddmm(series[0]?.day || '')}</span><span>{ddmm(series[series.length - 1]?.day || '')}</span></div>
        </Card>
        <Card title="Hỏi về gì">
          {data.topics.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có câu hỏi.</p> : (
            <ul className="space-y-2" aria-label="Chủ đề câu hỏi">
              {data.topics.map(x => (
                <li key={x.topic} className="text-sm">
                  <div className="flex justify-between gap-2"><span className="text-foreground">{TOPIC_LABEL[x.topic] || x.topic}</span><b className="tabular-nums">{x.questions}</b></div>
                  <span className="mt-1 block h-1.5 rounded-full bg-muted"><span className={`block h-full rounded-full ${x.topic === 'refused' ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${(x.questions / topicMax) * 100}%` }} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card id="act-commands" title="Thẻ nháp Trợ lý chuẩn bị">
        {data.commands.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có thẻ nháp nào trong kỳ.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" aria-label="Thẻ nháp theo loại">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 font-semibold">Loại</th><th className="text-right font-semibold">Chuẩn bị</th>
                <th className="text-right font-semibold">Đã gửi thật</th><th className="text-right font-semibold">Bỏ</th><th className="text-right font-semibold">Lỗi</th><th className="text-right font-semibold">Còn treo</th><th className="text-right font-semibold">Hết hạn</th></tr></thead>
              <tbody className="divide-y divide-border">
                {data.commands.map(c => (
                  <tr key={c.kind}>
                    <td className="py-1.5 font-semibold text-foreground">{COMMAND_LABEL[c.kind] || c.kind}</td>
                    <td className="text-right tabular-nums">{c.prepared}</td>
                    <td className={`text-right ${NUM}`}>{c.done}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{c.cancelled}</td>
                    <td className={`text-right tabular-nums ${c.failed ? 'text-rose-600' : 'text-muted-foreground'}`}>{c.failed}</td>
                    <td className="text-right tabular-nums">{c.open}</td>
                    <td className={`text-right tabular-nums ${c.expired ? 'text-amber-700' : 'text-muted-foreground'}`}>{c.expired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card id="act-people" title="Theo người" right={idle ? <span className="text-xs font-semibold text-amber-700">{idle} người chưa dùng</span> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" aria-label="Hoạt động theo người">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 font-semibold">Người</th><th className="text-right font-semibold">Câu hỏi</th>
              <th className="text-right font-semibold">Thẻ gửi thật</th><th className="text-right font-semibold">👎</th><th className="text-right font-semibold">Chạm trần</th>
              <th className="text-right font-semibold">Chi phí</th><th className="pl-3 font-semibold">Lần cuối</th></tr></thead>
            <tbody className="divide-y divide-border">
              {data.people.map(p => (
                <tr key={p.userId} aria-label={p.name} className={p.questions === 0 && p.runs === 0 ? 'text-muted-foreground' : ''}>
                  <td className="py-1.5"><span className={ENT}>{p.name}</span>{p.template && <span className="ml-1.5 text-[11px] text-muted-foreground">{p.template}</span>}
                    {!p.granted && <span className="ml-1.5 text-[11px] text-amber-700">chưa được cấp Trợ lý</span>}</td>
                  <td className={`text-right ${p.questions ? NUM : 'tabular-nums'}`}>{p.questions}</td>
                  <td className="text-right tabular-nums">{p.commands ? `${p.done}/${p.commands}` : '—'}</td>
                  <td className={`text-right tabular-nums ${p.dislikes ? 'text-rose-600' : ''}`}>{p.dislikes || '—'}</td>
                  <td className={`text-right tabular-nums ${p.blocked ? 'text-amber-700' : ''}`}>{p.blocked || '—'}</td>
                  <td className="text-right tabular-nums">{p.costUsd ? usd(p.costUsd) : '—'}</td>
                  <td className="pl-3 text-xs">{ago(p.lastAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card id="act-dislikes" title="👎 gần đây">
        {data.dislikes.length === 0 ? <p className="text-sm text-muted-foreground">Chưa ai chấm 👎 trong kỳ.</p> : (
          <ul className="divide-y divide-border" aria-label="Đánh giá chưa đúng gần đây">
            {data.dislikes.map((d, i) => (
              <li key={`${d.at}-${i}`} className="py-2 text-sm">
                <p><span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{reasonLabel(d.reason)}</span>
                  <span className="ml-2 text-foreground">{d.note || <span className="text-muted-foreground">Không ghi chú</span>}</span></p>
                <p className="mt-0.5 text-xs text-muted-foreground">{d.name} · {ddmm(d.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default AiActivityPanel;
