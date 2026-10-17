// Nhật ký · Dán báo cáo Zalo / chụp sổ → phiếu kỹ sư nháp (PR-2, chủ SP 17/10/2026).
// Người lập dán tin Zalo (có thể nhiều ngày) hoặc chụp sổ → AI tách ngày × mũi × dòng việc, gắn hạng mục kế hoạch, tổ đội →
// xem lại, sửa hạng mục → "Tạo N phiếu nháp" bằng đúng RPC phiếu kỹ sư. Không gửi, không ghi tiến độ: người lập mở phiếu, điền KL / % rồi gửi.
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Brain, Camera, CheckCircle2, ClipboardPaste, Loader2, Sparkles, X, XCircle } from 'lucide-react';
import type { ProjectTask } from '../../../types';
import { aiErrorMessage, aiGateway, type AiRunResult } from '../../../lib/aiGateway';
import { aiMemoryService } from '../../../lib/aiMemoryService';
import { dailyLogWbsService } from '../../../lib/dailyLogWbsService';
import {
  buildDrafts, datesInText, formatTaskRow, leafTaskRows, learnPairs, memoryHints, reportTaskWindow, slipSaveInput,
  type DraftSlip, type MemoryAlias, type ReportArea, type ReportRead, type ReportTaskRow,
} from '../../../lib/dailyLogReport';
import { recordSuggestionEvent } from '../../../lib/uiSuggestionEvents';
import { prepareCapturePhoto } from '../../../lib/wmsDeliveryCaptureService';
import { CaptureCamera } from '../../wms/CaptureCamera';
import { Badge, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { DailyLogInlineSearch } from './DailyLogInlineSearch';

// index.css trên điện thoại cắt `.grid > div .text-xs` thành 1 dòng — chữ báo cáo / hạng mục phải xuống dòng đủ.
const WRAP = '!whitespace-normal !overflow-visible';
const MAX_DAYS = 7;

export type DraftResult = { slip: DraftSlip; status: 'created' | 'exists' | 'error'; contributionId?: string; message?: string };

export interface ReportImportHooks {
  read: (input: { text: string; images: Array<{ mime: string; b64: string }>; reportDate: string; tasks: string; areas: string; crews: string; hints: string }) => Promise<AiRunResult<ReportRead>>;
  feedback: (runId: string, accepted: boolean) => void;
  memory: (projectId: string, siteId: string | null) => Promise<MemoryAlias[]>;
  learn: (projectId: string, siteId: string | null, pairs: ReturnType<typeof learnPairs>) => Promise<unknown>;
  recentAreas: (projectId: string, siteId: string | null, date: string) => Promise<ReportArea[]>;
  /** Tên tổ đội hay dùng ở dự án (từ phiếu gần đây) để AI gọi đúng tên. */
  knownCrews: (projectId: string, siteId: string | null, date: string) => Promise<string[]>;
  createDraft: (input: { projectId: string; siteId: string | null; slip: DraftSlip }) => Promise<DraftResult>;
}

const fileToB64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Không đọc được ảnh.'));
  r.readAsDataURL(f);
});

export const defaultReportImportHooks: ReportImportHooks = {
  read: input => aiGateway.run<ReportRead>('daily_log_from_report', input, { screen: 'daily_log', pages: input.images.length }),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
  memory: (projectId, siteId) => aiMemoryService.get(projectId, siteId).catch(() => []),
  learn: (projectId, siteId, pairs) => aiMemoryService.learn(projectId, siteId, pairs).catch(error => console.warn('AI memory learn failed:', error)),
  recentAreas: (projectId, siteId, date) => dailyLogWbsService.getRecentAreas({ projectId, constructionSiteId: siteId, date })
    .then(rows => (rows || []).map(area => ({ code: area.code, name: area.name }))).catch(() => []),
  knownCrews: (projectId, siteId, date) => dailyLogWbsService.getRecentAreas({ projectId, constructionSiteId: siteId, date })
    .then(rows => Array.from(new Set((rows || []).flatMap(area => area.labor.map(line =>
      (line.provider.entryMode === 'manual' ? line.provider.manualProviderName : line.provider.providerNameSnapshot) || line.laborType).filter(Boolean) as string[]))))
    .catch(() => []),
  createDraft: async ({ projectId, siteId, slip }) => {
    try {
      const receipt = await dailyLogWbsService.createSource({ commandId: crypto.randomUUID(), projectId, constructionSiteId: siteId, date: slip.date,
        workAreaCode: slip.areaCode, workAreaName: slip.areaName });
      const doc = await dailyLogWbsService.getDocumentBundle({ projectId, constructionSiteId: siteId, logDate: slip.date, contributionId: receipt.contributionId });
      await dailyLogWbsService.saveSourceDocument(slipSaveInput(slip, doc, { id: receipt.contributionId, rowVersion: doc.contribution?.rowVersion ?? receipt.rowVersion }));
      return { slip, status: 'created', contributionId: receipt.contributionId };
    } catch (error) {
      const known = error as { code?: string; existingContributionId?: string; message?: string };
      if (known.code === 'DAILY_LOG_SOURCE_AREA_EXISTS') return { slip, status: 'exists', contributionId: known.existingContributionId, message: 'Đã có phiếu của mũi này trong ngày — mở để bổ sung.' };
      return { slip, status: 'error', message: known.message || 'Chưa tạo được phiếu.' };
    }
  },
};

const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

export const DailyLogReportImport: React.FC<{
  projectId: string;
  constructionSiteId: string | null;
  tasks: ProjectTask[];
  defaultDate: string;
  onClose: () => void;
  onOpenSlip: (date: string, contributionId: string) => void;
  onCreated: () => void;
  hooks?: ReportImportHooks;
}> = ({ projectId, constructionSiteId, tasks, defaultDate, onClose, onOpenSlip, onCreated, hooks = defaultReportImportHooks }) => {
  const [step, setStep] = useState<'input' | 'reading' | 'review' | 'creating' | 'done'>('input');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [camera, setCamera] = useState(false);
  const [reportDate, setReportDate] = useState(defaultDate);
  const [error, setError] = useState('');
  const [slips, setSlips] = useState<DraftSlip[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [initialTasks, setInitialTasks] = useState<Map<string, string>>(new Map());
  const [results, setResults] = useState<DraftResult[]>([]);
  const [progress, setProgress] = useState(0);
  const rows = useMemo(() => leafTaskRows(tasks), [tasks]);
  const byId = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  const textDates = useMemo(() => datesInText(text, reportDate), [text, reportDate]);
  useEffect(() => () => { urls.forEach(u => URL.revokeObjectURL(u)); }, [urls]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !camera && step !== 'reading' && step !== 'creating') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [camera, onClose, step]);

  const read = async () => {
    if (text.trim().length < 10 && !files.length) { setError('Dán tin báo cáo hoặc chụp sổ trước.'); return; }
    if (!rows.length) { setError('Dự án chưa có hạng mục kế hoạch để gắn. Kiểm tra tab Tiến độ.'); return; }
    setError(''); setStep('reading');
    try {
      const dates = Array.from(new Set([reportDate, ...textDates]));
      const [memory, areas, crews] = await Promise.all([hooks.memory(projectId, constructionSiteId), hooks.recentAreas(projectId, constructionSiteId, reportDate),
        hooks.knownCrews(projectId, constructionSiteId, reportDate)]);
      const planRows = reportTaskWindow(rows, dates);
      const prepared = await Promise.all(files.slice(0, 4).map(f => prepareCapturePhoto(f).catch(() => f)));
      const images = await Promise.all(prepared.map(async f => ({ mime: f.type || 'image/jpeg', b64: await fileToB64(f) })));
      const r = await hooks.read({ text: text.trim(), images, reportDate, tasks: planRows.map(formatTaskRow).join('\n'),
        areas: areas.map(a => `${a.code} | ${a.name}`).join('\n'), crews: crews.join('\n'), hints: memoryHints(memory, rows) });
      if (r.code !== 'OK') { setError(`${aiErrorMessage(r)} Thử lại, hoặc ghi phiếu như bình thường.`); setStep('input'); return; }
      const drafts = buildDrafts(r.result, { reportDate, rows, areas, memory });
      if (!drafts.length) { setError('AI không thấy dòng việc nào — dán rõ hơn hoặc chụp lại sổ.'); setStep('input'); return; }
      setSlips(drafts); setWarnings(r.result.warnings); setRunId(r.runId); setSkipped(new Set());
      setInitialTasks(new Map(drafts.flatMap(slip => slip.works.map(work => [work.key, work.taskIds.join(',')] as [string, string]))));
      setStep('review');
    } catch (caught) {
      console.error('Daily log report read failed:', caught);
      setError('Chưa đọc được báo cáo. Thử lại.'); setStep('input');
    }
  };

  const patchWork = (slipKey: string, workKey: string, taskIds: string[]) => setSlips(cur => cur.map(slip => slip.key !== slipKey ? slip
    : { ...slip, works: slip.works.map(work => work.key === workKey ? { ...work, taskIds, source: work.source === 'memory' ? 'memory' : 'ai', reason: null } : work) }));

  const chosen = slips.filter(slip => !skipped.has(slip.key));
  const totalWorks = chosen.reduce((n, slip) => n + slip.works.length, 0);
  const pendingQs = chosen.reduce((n, slip) => n + slip.works.filter(work => !work.taskIds.length).length, 0);
  const unsure = chosen.reduce((n, slip) => n + slip.works.filter(work => work.source === 'low').length, 0);
  const dates = Array.from(new Set(slips.map(slip => slip.date)));

  const create = async () => {
    if (!chosen.length) return;
    setStep('creating'); setProgress(0);
    const out: DraftResult[] = [];
    for (const slip of chosen) {
      out.push(await hooks.createDraft({ projectId, siteId: constructionSiteId, slip }));
      setProgress(out.length);
    }
    setResults(out); setStep('done');
    const made = out.filter(r => r.status === 'created').map(r => r.slip);
    if (made.length) {
      onCreated();
      void hooks.learn(projectId, constructionSiteId, learnPairs(made, rows));
      if (runId) hooks.feedback(runId, true);
      const kept = made.reduce((n, slip) => n + slip.works.filter(work => initialTasks.get(work.key) === work.taskIds.join(',')).length, 0);
      const lines = made.reduce((n, slip) => n + slip.works.length, 0);
      recordSuggestionEvent({ screen: 'daily_log', field: 'report_ai', outcome: kept === lines ? 'accepted' : 'edited', suggested: lines, accepted: kept, source: { slips: made.length, days: new Set(made.map(s => s.date)).size } });
    }
  };

  const taskChip = (slip: DraftSlip, workKey: string, taskIds: string[], taskId: string) => {
    const row = byId.get(taskId);
    return <span key={taskId} className={`inline-flex max-w-full items-start gap-1 rounded-lg border border-mint-200 bg-mint-50 px-2 py-1 text-xs text-mint-900 dark:border-mint-900 dark:bg-mint-950/30 dark:text-mint-100 ${WRAP}`}>
      <span className="min-w-0"><b className="font-mono">{row?.code || '?'}</b> {row?.path.split(' › ').slice(-2).join(' › ') || 'Hạng mục không còn trong kế hoạch'}</span>
      <button type="button" aria-label={`Bỏ hạng mục ${row?.code || ''}`} onClick={() => patchWork(slip.key, workKey, taskIds.filter(id => id !== taskId))}
        className="shrink-0 rounded p-0.5 text-mint-700 hover:bg-mint-100 dark:text-mint-300"><X size={12} /></button>
    </span>;
  };

  return <div className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-slate-950/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Nhật ký từ báo cáo Zalo">
    <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-background shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-2xl">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-white"><ClipboardPaste size={19} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-foreground">Nhật ký từ báo cáo Zalo</p>
          <p className="truncate text-xs text-muted-foreground">{step === 'review' ? `${dates.length} ngày · ${chosen.length} phiếu nháp`
            : step === 'creating' || step === 'done' ? `Đã tạo ${results.filter(r => r.status === 'created').length}/${chosen.length} phiếu nháp`
            : 'Dán tin hoặc chụp sổ — AI tách ngày, mũi, hạng mục'}</p>
        </div>
        <button type="button" onClick={onClose} disabled={step === 'reading' || step === 'creating'} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><X size={18} /></button>
      </header>

      {(step === 'input' || step === 'reading') && <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={9} disabled={step === 'reading'} aria-label="Báo cáo Zalo"
          placeholder={'Dán tin báo cáo Zalo — dán nhiều ngày cùng lúc được. VD:\nBáo cáo ngày 15/10\nNhà xưởng: Tổ Mr Ích 20 người\n- Lắp dựng cofa cổ cột, dầm chân tường\n- Xây tường hành lang'}
          className={`w-full resize-y font-mono text-sm ${inputCls}`} />
        <div className="flex flex-wrap items-center gap-2">
          {urls.map((u, i) => <img key={u} src={u} alt={`Ảnh sổ ${i + 1}`} className="h-16 w-12 rounded-md border border-border object-cover" />)}
          <button type="button" onClick={() => setCamera(true)} disabled={step === 'reading'} className={`${secondaryBtn} bg-card`}>
            <Camera size={15} />{files.length ? 'Chụp thêm' : 'Chụp sổ / chọn ảnh'}</button>
        </div>
        <label className="block text-xs font-semibold text-muted-foreground">Ngày báo cáo (cho dòng không ghi ngày)
          <input type="date" value={reportDate} max={defaultDate} onChange={e => setReportDate(e.target.value || defaultDate)} disabled={step === 'reading'}
            className={`mt-1 block w-full sm:w-48 ${inputCls}`} /></label>
        {textDates.length > 0 && <p className={`text-xs ${textDates.length > MAX_DAYS ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
          Thấy {textDates.length} ngày trong tin: {textDates.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ')}{textDates.length > MAX_DAYS ? ` — nên dán tối đa ${MAX_DAYS} ngày mỗi lần để AI đọc kịp.` : ''}</p>}
        {error && <p role="alert" className="flex gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</p>}
      </div>}

      {step === 'review' && <div className="flex-1 overflow-y-auto">
        <div data-testid="report-summary" className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5 text-xs">
          <Badge className="border-mint-200 bg-mint-50 text-mint-800 dark:border-mint-900 dark:bg-mint-950/30 dark:text-mint-200">{totalWorks} dòng việc</Badge>
          {unsure > 0 && <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{unsure} chưa chắc — kiểm tra</Badge>}
          {pendingQs > 0 && <Badge className="border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{pendingQs} ngoài kế hoạch — chờ QS</Badge>}
          {warnings.length > 0 && <details className="w-full text-muted-foreground"><summary className="cursor-pointer font-semibold text-amber-800 dark:text-amber-200">{warnings.length} lưu ý của AI</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{warnings.map(w => <li key={w} className={WRAP}>{w}</li>)}</ul></details>}
        </div>
        {dates.map(date => <section key={date} className="border-b border-border px-4 py-3">
          <h3 className="mb-2 text-sm font-bold capitalize text-foreground">{dayLabel(date)}</h3>
          <div className="space-y-3">
            {slips.filter(slip => slip.date === date).map(slip => {
              const off = skipped.has(slip.key);
              return <article key={slip.key} data-testid="report-slip" className={`rounded-xl border border-border bg-card ${off ? 'opacity-50' : ''}`}>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                  <p className="min-w-0 flex-1 text-sm font-bold text-mint-700 dark:text-mint-300">{slip.areaName}</p>
                  {slip.crews.map(crew => <span key={crew.key} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                    {crew.fromMemory && <Brain size={11} className="text-teal-600" aria-label="Đã nhớ" />}{crew.label}{crew.people ? <b className="tabular-nums">· {crew.people} người</b> : <span className="text-amber-700">· chưa ghi số người</span>}</span>)}
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" checked={!off} onChange={() => setSkipped(cur => { const next = new Set(cur); if (next.has(slip.key)) next.delete(slip.key); else next.add(slip.key); return next; })} />Tạo phiếu</label>
                </div>
                <ul className="divide-y divide-border">
                  {slip.works.map(work => <li key={work.key} className="space-y-1.5 px-3 py-2">
                    <p className={`text-sm text-foreground ${WRAP}`}>{work.text}{work.location && !work.text.includes(work.location) ? <span className="text-muted-foreground"> · {work.location}</span> : null}
                      {work.percent != null && <b className="ml-1 tabular-nums text-leaf-700"> {work.percent}%</b>}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {work.source === 'memory' && <Badge className="border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200"><Brain size={11} />Đã nhớ</Badge>}
                      {work.source === 'low' && <span title={work.reason || undefined}><Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Chưa chắc</Badge></span>}
                      {!work.taskIds.length && <Badge className="border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">Ngoài kế hoạch — chờ QS</Badge>}
                      {work.taskIds.map(taskId => taskChip(slip, work.key, work.taskIds, taskId))}
                    </div>
                    {work.source === 'low' && work.reason && <p className={`text-xs text-amber-800 dark:text-amber-200 ${WRAP}`}>{work.reason}</p>}
                    {!off && <div className="max-w-md">
                      <DailyLogInlineSearch<ReportTaskRow> label={`Thêm hạng mục cho: ${work.text}`} placeholder="+ Hạng mục — gõ mã hoặc tên" items={rows.filter(row => !work.taskIds.includes(row.id))}
                        text={row => `${row.code} ${row.path}`} limit={30}
                        render={row => <span className={WRAP}><b className="font-mono text-mint-700 dark:text-mint-300">{row.code}</b> {row.path} <span className="text-muted-foreground">· {row.progress}%</span></span>}
                        onPick={row => patchWork(slip.key, work.key, [...work.taskIds, row.id])} />
                    </div>}
                  </li>)}
                </ul>
                {(slip.issues.length > 0 || slip.nextDayPlan) && <p className={`border-t border-border px-3 py-2 text-xs text-muted-foreground ${WRAP}`}>
                  {slip.issues.length > 0 && <>Sự cố: {slip.issues.join('; ')}. </>}{slip.nextDayPlan && <>Kế hoạch mai: {slip.nextDayPlan}</>}</p>}
              </article>;
            })}
          </div>
        </section>)}
      </div>}

      {(step === 'creating' || step === 'done') && <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="report-results">
        {step === 'creating' && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin text-teal-600" />Đang tạo phiếu {progress}/{chosen.length}…</p>}
        {results.map(r => <div key={r.slip.key} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <p className={`min-w-0 flex-1 text-sm ${WRAP}`}>
            {r.status === 'created' ? <CheckCircle2 size={15} className="mr-1 inline -translate-y-px text-leaf-600" /> : r.status === 'exists' ? <AlertTriangle size={15} className="mr-1 inline -translate-y-px text-amber-600" /> : <XCircle size={15} className="mr-1 inline -translate-y-px text-rose-600" />}
            <b>{r.slip.date.slice(8, 10)}/{r.slip.date.slice(5, 7)} · {r.slip.areaName}</b>
            <span className="text-muted-foreground"> — {r.status === 'created' ? `phiếu nháp ${r.slip.works.length} dòng việc` : r.message}</span></p>
          {r.contributionId && <button type="button" onClick={() => onOpenSlip(r.slip.date, r.contributionId!)} className={`${secondaryBtn} shrink-0 bg-card`}>Mở phiếu</button>}
        </div>)}
        {step === 'done' && results.some(r => r.status === 'created') && <p className="text-xs text-muted-foreground">Phiếu là nháp của bạn: mở từng phiếu, điền khối lượng / % rồi gửi tổng hợp. Cách gọi vừa xác nhận đã được nhớ cho lần sau.</p>}
      </div>}

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {step === 'reading' && <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin text-teal-600" />AI đang đọc… (10–40 giây)</span>}
        {(step === 'input' || step === 'reading') && <>
          <button type="button" onClick={onClose} disabled={step === 'reading'} className={`${secondaryBtn} flex-1 sm:flex-none`}>Hủy</button>
          <button type="button" onClick={() => void read()} disabled={step === 'reading' || (text.trim().length < 10 && !files.length)} className={`${primaryBtn} flex-1 sm:flex-none`}
            title={text.trim().length < 10 && !files.length ? 'Dán tin báo cáo hoặc chụp sổ trước' : undefined}>
            {step === 'reading' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}AI đọc báo cáo</button>
        </>}
        {step === 'review' && <>
          <button type="button" onClick={() => setStep('input')} className={`${secondaryBtn} flex-1 sm:flex-none`}>Sửa lại chữ</button>
          <button type="button" onClick={() => void create()} disabled={!chosen.length} className={`${primaryBtn} flex-1 sm:flex-none`}>
            <CheckCircle2 size={15} />Tạo {chosen.length} phiếu nháp</button>
        </>}
        {step === 'done' && <button type="button" onClick={onClose} className={`${primaryBtn} flex-1 sm:flex-none`}>Xong</button>}
      </footer>
    </div>
    {camera && <CaptureCamera title="Chụp sổ báo cáo" onClose={() => setCamera(false)} onDone={picked => {
      setCamera(false);
      const imgs = picked.filter(f => f.type.startsWith('image/'));
      setFiles(cur => [...cur, ...imgs].slice(0, 4));
      setUrls(cur => [...cur, ...imgs.map(f => URL.createObjectURL(f))].slice(0, 4));
    }} />}
  </div>;
};
