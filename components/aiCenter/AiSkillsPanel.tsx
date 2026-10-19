// Trung tâm AI · tab Skill (chủ SP 19/10/2026): danh sách skill gắn nút + công cụ Trợ lý tự chọn, kèm lượt dùng 7 ngày.
// Bấm một dòng → ngăn CHỈ XEM: dùng khi nào, quyền, kết quả / thẻ tạo ra, lời dặn gửi model, lượt dùng. Đổi "ai được dùng" vẫn ở dòng như cũ.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, ChevronRight, Database, FilePenLine, MapPin, MessageSquareText, Search, ShieldCheck, Sparkles, TriangleAlert, Wrench } from 'lucide-react';
import { Badge, Drawer, StateBox, secondaryBtn } from '../procurement/hub/hubUi';
import { NUM } from '../finance/financeUi';
import type { AiSkillAccessRow, SkillAccess } from '../../lib/aiAdmin';
import { usd } from '../../lib/aiAdmin';
import {
  MODE_LABEL, TIER_PERMISSION, TOOL_KIND_LABEL, lineCount, type AiSkillCatalogService, type CatalogTool, type SkillCatalog, type SkillUsage, type ToolKind,
} from '../../lib/aiSkillCatalog';

type Load<T> = T | 'loading' | { error: string };
const isReady = <T,>(v: Load<T>): v is T => v !== 'loading' && !(typeof v === 'object' && v !== null && 'error' in v);
const errorOf = <T,>(v: Load<T>) => (typeof v === 'object' && v !== null && 'error' in v ? (v as { error: string }).error : null);
const nf = new Intl.NumberFormat('vi-VN');
const pad = (n: number) => String(n).padStart(2, '0');
const lastText = (iso: string | null) => {
  if (!iso) return 'Chưa dùng';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const KIND_ICON: Record<ToolKind, React.ElementType> = { tra_cuu: Search, bieu_do: BarChart3, chuan_bi: FilePenLine };
const KIND_TONE: Record<ToolKind, string> = {
  tra_cuu: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  bieu_do: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200',
  chuan_bi: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-200',
};

const Stat: React.FC<{ label: string; value: string; hint?: string; warn?: boolean }> = ({ label, value, hint, warn }) => (
  <div className="rounded-xl border border-border bg-card px-3 py-2">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className={`mt-0.5 text-xl ${warn ? 'font-semibold tabular-nums text-rose-600' : NUM}`}>{value}</dd>
    {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
  </div>
);
const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <section className="space-y-1.5">
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon size={14} /> {title}</h3>
    <div className="text-sm text-foreground">{children}</div>
  </section>
);
/** Lời dặn gửi model: gập sẵn (dài), chữ giữ nguyên xuống dòng, cuộn trong khung. */
const Prompt: React.FC<{ title: string; text: string; note?: string; open?: boolean }> = ({ title, text, note, open }) => (
  <details className="group rounded-xl border border-border bg-card" open={open}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-foreground">
      <span>{title}</span><span className="text-xs font-normal text-muted-foreground">{lineCount(text)} dòng <ChevronRight size={13} className="inline transition-transform group-open:rotate-90" /></span>
    </summary>
    {note && <p className="px-3 text-xs text-muted-foreground">{note}</p>}
    <pre className="m-3 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 font-sans text-[12.5px] leading-relaxed text-foreground" data-testid="prompt">{text}</pre>
  </details>
);

type Open = { type: 'skill'; code: string } | { type: 'tool'; name: string; from?: string };

const AiSkillsPanel: React.FC<{
  skills: AiSkillAccessRow[]; busy: string | null; onSetAccess: (code: string, name: string, access: SkillAccess) => void; service: AiSkillCatalogService;
}> = ({ skills, busy, onSetAccess, service }) => {
  const [usage, setUsage] = useState<Load<SkillUsage>>('loading');
  const [catalog, setCatalog] = useState<Load<SkillCatalog>>('loading');
  const [open, setOpen] = useState<Open | null>(null);

  const loadUsage = useCallback(() => {
    setUsage('loading');
    service.usage(7).then(setUsage, e => setUsage({ error: e instanceof Error ? e.message : String(e) }));
  }, [service]);
  const loadCatalog = useCallback(() => {
    setCatalog('loading');
    service.catalog().then(setCatalog, e => setCatalog({ error: e instanceof Error ? e.message : String(e) }));
  }, [service]);
  useEffect(() => { loadUsage(); loadCatalog(); }, [loadUsage, loadCatalog]);

  const days = isReady(usage) ? usage.days : 7;
  const skillUse = (code: string) => (isReady(usage) ? usage.skills.find(s => s.code === code) : undefined);
  const toolUse = (name: string) => (isReady(usage) ? usage.tools.find(t => t.tool === name) : undefined);
  const commandUse = (kind: string | null) => (kind && isReady(usage) ? usage.commands.find(c => c.kind === kind) : undefined);
  const catSkill = (code: string) => (isReady(catalog) ? catalog.skills.find(s => s.code === code) : undefined);
  const tools: CatalogTool[] = isReady(catalog) ? catalog.tools : [];
  const runsText = (runs: number | undefined, people: number | undefined) =>
    usage === 'loading' ? '…' : !isReady(usage) ? '—' : runs ? `${nf.format(runs)} lượt · ${nf.format(people || 0)} người` : 'Chưa dùng';
  const chat = skills.find(s => s.code === 'assistant_chat');
  const buttonSkills = skills.filter(s => s.code !== 'assistant_chat');

  const skillRow = (s: AiSkillAccessRow) => {
    const cat = catSkill(s.code);
    const u = skillUse(s.code);
    return (
      <li key={s.code} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" aria-label={s.name}>
        <button type="button" onClick={() => setOpen({ type: 'skill', code: s.code })} className="group flex min-w-0 flex-1 basis-60 items-center gap-2 text-left" aria-label={`Xem bên trong ${s.name}`}>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-foreground group-hover:text-teal-700">{s.name}{!s.enabled && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Đang tắt</span>}</span>
            <span className={`block truncate text-xs ${cat && !cat.where ? 'text-amber-700' : 'text-muted-foreground'}`} title={cat?.where || undefined}>
              {catalog === 'loading' ? s.code : cat ? (cat.where || 'Chưa gắn màn nào') : s.code}
            </span>
          </span>
        </button>
        <span className="w-full text-xs tabular-nums text-muted-foreground sm:w-auto sm:min-w-[120px] sm:text-right" title={`Lượt ${days} ngày gần nhất`}>{runsText(u?.runs, u?.people)}</span>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label={`Ai được dùng ${s.name}`}>
          {(['everyone', 'granted'] as const).map(a => (
            <button key={a} type="button" role="radio" aria-checked={s.access === a} disabled={busy === s.code}
              onClick={() => { if (s.access !== a) onSetAccess(s.code, s.name, a); }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${s.access === a ? 'bg-leaf-600 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
              {a === 'everyone' ? 'Mọi người' : 'Chỉ người được cấp'}</button>
          ))}
        </div>
        <button type="button" onClick={() => setOpen({ type: 'skill', code: s.code })} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label={`Mở ${s.name}`}><ChevronRight size={16} /></button>
      </li>
    );
  };

  return (
    <section role="tabpanel" aria-label="Skill" className="space-y-4">
      {errorOf(usage) && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
          <TriangleAlert size={15} /> Chưa đọc được lượt dùng: {errorOf(usage)}
          <button type="button" className="font-semibold underline" onClick={loadUsage}>Thử lại</button>
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <h2 className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-sm font-bold text-foreground">
          <span>Skill</span><span className="text-xs font-medium text-muted-foreground">Lượt {days} ngày · Ai được dùng</span>
        </h2>
        <ul className="divide-y divide-border">
          {chat && skillRow(chat)}
          {buttonSkills.map(skillRow)}
        </ul>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <h2 className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-sm font-bold text-foreground">
          <span title="Trợ lý đọc mục 'Dùng khi' của từng công cụ để tự chọn công cụ hợp câu hỏi">Công cụ Trợ lý tự chọn</span>
          <span className="text-xs font-medium text-muted-foreground">{tools.length ? `${tools.length} công cụ · lượt ${days} ngày` : ''}</span>
        </h2>
        {catalog === 'loading' && <div className="p-4"><StateBox kind="loading" /></div>}
        {errorOf(catalog) && <div className="p-4"><StateBox kind="error" message={errorOf(catalog)!} onRetry={loadCatalog} /></div>}
        {isReady(catalog) && (
          <ul className="divide-y divide-border">
            {tools.map(t => {
              const Icon = KIND_ICON[t.kind];
              const u = toolUse(t.name);
              return (
                <li key={t.name}>
                  <button type="button" onClick={() => setOpen({ type: 'tool', name: t.name })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50" aria-label={`Xem công cụ ${t.label}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${KIND_TONE[t.kind]}`}><Icon size={14} /></span>
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-foreground">{t.label}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{t.name}</span></span>
                    <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <Badge className={KIND_TONE[t.kind]}>{TOOL_KIND_LABEL[t.kind]}</Badge>
                      <span className="text-xs tabular-nums text-muted-foreground sm:min-w-[120px] sm:text-right">{runsText(u?.runs, u?.people)}</span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open?.type === 'skill' && (() => {
        const row = skills.find(s => s.code === open.code);
        const u = skillUse(open.code);
        const cat = catSkill(open.code);
        const full = isReady(usage) ? usage.skills.find(s => s.code === open.code) : undefined;
        return (
          <Drawer label={`Skill ${row?.name || open.code}`} onClose={() => setOpen(null)} header={
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-lg font-bold text-foreground"><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white"><Sparkles size={16} /></span>{row?.name || open.code}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge className="border-border bg-muted font-mono text-muted-foreground">{open.code}</Badge>
                <Badge className={row?.enabled === false ? 'border-border bg-muted text-muted-foreground' : 'border-leaf-200 bg-leaf-50 text-leaf-800'}>{row?.enabled === false ? 'Đang tắt' : 'Đang bật'}</Badge>
                {full && <Badge className="border-sky-200 bg-sky-50 text-sky-800">{MODE_LABEL[full.mode] || full.mode}</Badge>}
                {cat?.readsImages && <Badge className="border-border bg-card text-foreground">Đọc ảnh</Badge>}
              </div>
            </div>
          }>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`Lượt dùng ${days} ngày`}>
              <Stat label={`Lượt ${days} ngày`} value={u ? nf.format(u.runs) : usage === 'loading' ? '…' : '—'} hint={u ? `${nf.format(u.people)} người · lần cuối ${lastText(u.lastAt)}` : undefined} />
              <Stat label="Chi phí" value={u ? usd(u.costUsd) : '—'} />
              <Stat label="👍 / 👎" value={u ? `${u.likes} / ${u.dislikes}` : '—'} warn={Boolean(u && u.dislikes > u.likes)} />
              <Stat label="Lỗi · bị chặn" value={u ? `${u.errors} · ${u.blocked}` : '—'} hint={u?.blocked ? 'bị chặn: không quyền, hết lượt, từ chối' : undefined} warn={Boolean(u && u.errors > 0)} />
            </dl>
            <Section icon={MapPin} title="Dùng khi nào">
              {cat ? (cat.where ? <p>{cat.where}</p> : <p className="text-amber-700">Chưa gắn màn nào — chưa ai gọi được skill này.</p>) : catalog === 'loading' ? <p className="text-muted-foreground">Đang đọc…</p> : null}
              {full?.description && <p className="mt-1 text-muted-foreground">{full.description}</p>}
            </Section>
            <Section icon={ShieldCheck} title="Quyền">
              <p>{row?.access === 'granted' ? 'Chỉ người được cấp ở Trung tâm AI' : full ? TIER_PERMISSION[full.tier] || full.tier : 'Mọi người có quyền vào màn đó'}</p>
              {row && <p className="text-muted-foreground">Tối đa {nf.format(row.dailyLimit)} lượt / người / ngày · chung trần tiền và câu của từng người</p>}
            </Section>
            {cat && <Section icon={MessageSquareText} title="Kết quả trả về"><p>{cat.result}</p></Section>}
            {cat && cat.tools.length > 0 && (
              <Section icon={Wrench} title={`Công cụ AI tự chọn · ${cat.tools.length}`}>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {cat.tools.map(name => {
                    const t = tools.find(x => x.name === name);
                    if (!t) return null;
                    const Icon = KIND_ICON[t.kind];
                    return <li key={name}><button type="button" onClick={() => setOpen({ type: 'tool', name, from: open.code })} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50">
                      <Icon size={14} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{runsText(toolUse(name)?.runs, toolUse(name)?.people)}</span><ChevronRight size={14} className="text-muted-foreground" /></button></li>;
                  })}
                </ul>
              </Section>
            )}
            {errorOf(catalog) && <StateBox kind="error" message={errorOf(catalog)!} onRetry={loadCatalog} />}
            {catalog === 'loading' && <StateBox kind="loading" />}
            {isReady(catalog) && !cat && <StateBox kind="empty" title="Chưa có lời dặn để xem" message="Skill này chưa có trong cổng AI đang chạy." />}
            {cat && <Prompt title="Lời dặn gửi model" text={cat.instructions}
              note={cat.tools.length ? 'Phần cố định. Khi hỏi thật có thêm: ngày giờ, danh mục loại nghỉ, ghi nhớ của người hỏi, hồ sơ vừa tìm.' : undefined} />}
            {isReady(catalog) && catalog.guard && cat && cat.tools.length === 0 && <Prompt title="Quy tắc an toàn chung (gửi kèm trước lời dặn)" text={catalog.guard} />}
          </Drawer>
        );
      })()}

      {open?.type === 'tool' && (() => {
        const t = tools.find(x => x.name === open.name);
        const u = toolUse(open.name);
        const cmd = commandUse(t?.commandKind ?? null);
        const back = open.from ? skills.find(s => s.code === open.from) : undefined;
        const Icon = t ? KIND_ICON[t.kind] : Wrench;
        return (
          <Drawer label={`Công cụ ${t?.label || open.name}`} onClose={() => setOpen(null)} header={
            <div className="min-w-0">
              {back && <button type="button" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline" onClick={() => setOpen({ type: 'skill', code: back.code })}><ArrowLeft size={13} /> {back.name}</button>}
              <p className="flex items-center gap-2 text-lg font-bold text-foreground"><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white"><Icon size={16} /></span>{t?.label || open.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge className="border-border bg-muted font-mono text-muted-foreground">{open.name}</Badge>
                {t && <Badge className={KIND_TONE[t.kind]}>{TOOL_KIND_LABEL[t.kind]}</Badge>}
              </div>
            </div>
          }>
            {!t ? <StateBox kind="empty" title="Không thấy công cụ này" message="Công cụ không còn trong cổng AI đang chạy." /> : <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`Lượt dùng ${days} ngày`}>
                <Stat label={`Lượt ${days} ngày`} value={u ? nf.format(u.runs) : usage === 'loading' ? '…' : isReady(usage) ? '0' : '—'} hint={u ? `${nf.format(u.people)} người` : undefined} />
                <Stat label="Lần cuối" value={u ? lastText(u.lastAt) : 'Chưa dùng'} />
                {t.commandKind && <Stat label="Thẻ đã tạo" value={cmd ? nf.format(cmd.prepared) : isReady(usage) ? '0' : '—'} />}
                {t.commandKind && <Stat label="Gửi thật" value={cmd ? nf.format(cmd.done) : isReady(usage) ? '0' : '—'} hint={cmd && cmd.prepared ? `${Math.round((cmd.done / cmd.prepared) * 100)}% số thẻ` : undefined} />}
              </dl>
              <Section icon={MessageSquareText} title="AI dùng khi nào">
                <p className="rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2 dark:border-teal-800 dark:bg-teal-950/30" data-testid="tool-when">{t.description}</p>
                <p className="text-xs text-muted-foreground">Đúng đoạn Trợ lý đọc để tự chọn công cụ này.</p>
              </Section>
              <Section icon={ShieldCheck} title="Quyền"><p>{t.permission}</p><p className="text-xs text-muted-foreground">Máy chủ kiểm bằng phiên người hỏi — AI không thấy hơn người hỏi.</p></Section>
              <Section icon={t.kind === 'chuan_bi' ? FilePenLine : t.kind === 'bieu_do' ? BarChart3 : Search} title={t.kind === 'chuan_bi' ? 'Thẻ tạo ra' : 'Kết quả'}>
                <p>{t.result}</p>
                {t.kind === 'chuan_bi' && <p className="text-xs text-muted-foreground">Chỉ là nháp — người dùng tự bấm gửi; AI không tự gửi, duyệt, xóa.</p>}
              </Section>
              <Section icon={Database} title="Dữ liệu lấy từ">
                <div className="flex flex-wrap gap-1.5">{t.rpcs.map(r => <code key={r} className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11.5px]">{r}</code>)}</div>
              </Section>
              {t.params.length > 0 && (
                <details className="group rounded-xl border border-border bg-card">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-foreground">
                    <span>Thông tin AI tự điền</span><span className="text-xs font-normal text-muted-foreground">{t.params.length} mục <ChevronRight size={13} className="inline transition-transform group-open:rotate-90" /></span>
                  </summary>
                  <ul className="space-y-2 px-3 pb-3 text-sm">
                    {t.params.map(p => <li key={p.name}><code className="text-[12px] font-semibold text-foreground">{p.name}</code>{p.required && <span className="ml-1 text-[11px] font-semibold text-amber-700">bắt buộc</span>}
                      <p className="text-muted-foreground">{p.description || '—'}</p></li>)}
                  </ul>
                </details>
              )}
            </>}
            {back && <div><button type="button" className={secondaryBtn} onClick={() => setOpen({ type: 'skill', code: back.code })}><ArrowLeft size={15} /> Về {back.name}</button></div>}
          </Drawer>
        );
      })()}
    </section>
  );
};

export default AiSkillsPanel;
