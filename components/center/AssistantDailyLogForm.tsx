import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Brain, CheckCircle2, Loader2, RotateCcw, X } from 'lucide-react';
import { dailyLogView, type AssistantCommand } from '../../lib/assistantCommands';
import type { DailyLogFormActions } from '../../lib/assistantDailyLogForm';
import { leafTaskRows, type DraftSlip, type ReportTaskRow } from '../../lib/dailyLogReport';
import { createReportDrafts, readReportDrafts, type DraftResult } from '../project/daily-log/DailyLogReportImport';
import { DailyLogInlineSearch } from '../project/daily-log/DailyLogInlineSearch';

// Nhật ký từ báo cáo Zalo ngay trong khung chat (chủ SP 18/10/2026): thẻ tự đọc báo cáo bằng bộ của màn Nhật ký → ngày × mũi × dòng việc,
// hạng mục kế hoạch, tổ đội → người dùng bỏ / thêm hạng mục, bỏ mũi không cần → "Tạo N phiếu nháp" (đúng RPC phiếu kỹ sư).
// Không ghi tiến độ: mở phiếu điền KL / % rồi gửi tổng hợp như thường.

const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });

export interface DailyLogReceiptSlip { date: string; area: string; status: DraftResult['status']; contributionId: string | null; works: number; message: string | null }

const AssistantDailyLogForm: React.FC<{
  command: AssistantCommand;
  actions: DailyLogFormActions;
  you: string;
  onCreated: (slips: DailyLogReceiptSlip[]) => Promise<void> | void;
  onCancel: () => void;
  busyCancel?: boolean;
}> = ({ command, actions, you, onCreated, onCancel, busyCancel = false }) => {
  const v = useMemo(() => dailyLogView(command), [command]);
  const [rows, setRows] = useState<ReportTaskRow[] | null>(null);
  const [state, setState] = useState<'reading' | 'review' | 'creating' | 'error'>('reading');
  const [error, setError] = useState<string | null>(null);
  const [slips, setSlips] = useState<DraftSlip[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [initialTasks, setInitialTasks] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState('reading'); setError(null);
    (async () => {
      const tasks = await actions.tasks(v.projectId, v.siteId);
      const leaf = leafTaskRows(tasks);
      if (!alive) return;
      setRows(leaf);
      const outcome = await readReportDrafts(actions.hooks, { projectId: v.projectId, siteId: v.siteId, rows: leaf, text: v.text, images: [], reportDate: v.reportDate });
      if (!alive) return;
      if ('error' in outcome) { setError(outcome.error); setState('error'); return; }
      setSlips(outcome.drafts); setWarnings(outcome.warnings); setRunId(outcome.runId); setSkipped(new Set());
      setInitialTasks(new Map(outcome.drafts.flatMap(slip => slip.works.map(work => [work.key, work.taskIds.join(',')] as [string, string]))));
      setState('review');
    })().catch(e => { if (alive) { setError(e instanceof Error ? e.message : 'Chưa đọc được báo cáo.'); setState('error'); } });
    return () => { alive = false; };
    // Đọc một lần cho mỗi thẻ (bấm "Đọc lại" để chạy lại).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.id, attempt]);

  const byId = useMemo(() => new Map((rows || []).map(row => [row.id, row])), [rows]);
  const patchWork = (slipKey: string, workKey: string, taskIds: string[]) => setSlips(cur => cur.map(slip => slip.key !== slipKey ? slip
    : { ...slip, works: slip.works.map(work => work.key === workKey ? { ...work, taskIds, source: work.source === 'memory' ? 'memory' : 'ai', reason: null } : work) }));
  const chosen = slips.filter(slip => !skipped.has(slip.key));
  const dates = Array.from(new Set(slips.map(slip => slip.date)));
  const outside = chosen.reduce((n, slip) => n + slip.works.filter(work => !work.taskIds.length).length, 0);
  const unsure = chosen.reduce((n, slip) => n + slip.works.filter(work => work.source === 'low').length, 0);

  const create = async () => {
    if (!chosen.length || !rows) return;
    setState('creating'); setProgress(0); setError(null);
    try {
      const out = await createReportDrafts(actions.hooks, { projectId: v.projectId, siteId: v.siteId, slips: chosen, rows, runId, initialTasks, onProgress: setProgress, source: 'assistant' });
      await onCreated(out.map(r => ({ date: r.slip.date, area: r.slip.areaName, status: r.status, contributionId: r.contributionId || null, works: r.slip.works.length, message: r.message || null })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa tạo được phiếu.'); setState('review');
    }
  };

  if (state === 'reading') return <p className="vcc-cmd-muted vcc-mr-loading" role="status"><Loader2 size={14} className="animate-spin" /> Đang đọc báo cáo bằng bộ của màn Nhật ký… (10–40 giây)</p>;
  if (state === 'error') {
    return (
      <div className="vcc-mr">
        <p className="vcc-cmd-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</p>
        <div className="vcc-cmd-actions">
          <button type="button" className="vcc-btn" data-pri="true" onClick={() => setAttempt(n => n + 1)}><RotateCcw size={14} /> Đọc lại</button>
          <button type="button" className="vcc-btn" onClick={onCancel} disabled={busyCancel}><X size={14} /> Bỏ</button>
        </div>
      </div>
    );
  }
  const locked = state === 'creating';
  return (
    <div className="vcc-mr" data-testid="dl-form">
      <div className="vcc-mr-chips" aria-label="Tóm tắt">
        <span className="vcc-mr-pill" data-tone="ok">{chosen.reduce((n, s) => n + s.works.length, 0)} dòng việc · {chosen.length} phiếu · {dates.length} ngày</span>
        {unsure > 0 && <span className="vcc-mr-pill" data-tone="warn">{unsure} chưa chắc — kiểm</span>}
        {outside > 0 && <span className="vcc-mr-pill" data-tone="warn">{outside} ngoài kế hoạch — chờ QS</span>}
      </div>
      {warnings.length > 0 && <details className="vcc-dl-warn"><summary>{warnings.length} lưu ý của AI</summary><ul>{warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      {dates.map(date => (
        <section key={date} className="vcc-dl-day" aria-label={dayLabel(date)}>
          <h4>{dayLabel(date)}</h4>
          {slips.filter(slip => slip.date === date).map(slip => {
            const off = skipped.has(slip.key);
            return (
              <article key={slip.key} className="vcc-mr-row" data-state={off ? 'todo' : 'ok'} data-testid="dl-slip" aria-label={`${slip.areaName} ${date}`}>
                <div className="vcc-mr-row-head vcc-dl-head">
                  <b className="vcc-dl-area">{slip.areaName}</b>
                  {slip.crews.map(crew => <span key={crew.key} className="vcc-mr-pill" data-tone={crew.people ? 'ok' : 'warn'}>
                    {crew.fromMemory && <Brain size={11} aria-label="Đã nhớ" />}{crew.label}{crew.people ? ` · ${crew.people} người` : ' · chưa ghi số người'}</span>)}
                  <label className="vcc-dl-toggle"><input type="checkbox" checked={!off} disabled={locked}
                    onChange={() => setSkipped(cur => { const next = new Set(cur); if (next.has(slip.key)) next.delete(slip.key); else next.add(slip.key); return next; })} /> Tạo phiếu</label>
                </div>
                {!off && <ul className="vcc-dl-works">
                  {slip.works.map(work => (
                    <li key={work.key}>
                      <p>{work.text}{work.location && !work.text.includes(work.location) ? <span className="vcc-cmd-muted"> · {work.location}</span> : null}</p>
                      <div className="vcc-mr-chips">
                        {work.source === 'memory' && <span className="vcc-mr-pill" data-tone="ok"><Brain size={11} aria-hidden="true" />Đã nhớ</span>}
                        {work.source === 'low' && <span className="vcc-mr-pill" data-tone="warn" title={work.reason || undefined}>Chưa chắc</span>}
                        {!work.taskIds.length && <span className="vcc-mr-pill" data-tone="warn">Ngoài kế hoạch — chờ QS</span>}
                        {work.taskIds.map(taskId => {
                          const row = byId.get(taskId);
                          return <span key={taskId} className="vcc-dl-task"><b>{row?.code || '?'}</b> {row?.path.split(' › ').slice(-2).join(' › ') || 'Hạng mục không còn trong kế hoạch'}
                            <button type="button" aria-label={`Bỏ hạng mục ${row?.code || ''}`} disabled={locked} onClick={() => patchWork(slip.key, work.key, work.taskIds.filter(id => id !== taskId))}><X size={11} /></button></span>;
                        })}
                      </div>
                      {work.source === 'low' && work.reason && <p className="vcc-mr-warn"><AlertTriangle size={12} aria-hidden="true" /> {work.reason}</p>}
                      {!locked && <div className="vcc-dl-add">
                        <DailyLogInlineSearch<ReportTaskRow> label={`Thêm hạng mục cho: ${work.text}`} placeholder="+ Hạng mục — gõ mã hoặc tên" items={(rows || []).filter(row => !work.taskIds.includes(row.id))}
                          text={row => `${row.code} ${row.path}`} limit={30}
                          render={row => <span><b>{row.code}</b> {row.path} · {row.progress}%</span>}
                          onPick={row => patchWork(slip.key, work.key, [...work.taskIds, row.id])} />
                      </div>}
                    </li>
                  ))}
                </ul>}
                {!off && (slip.issues.length > 0 || slip.nextDayPlan) && <p className="vcc-cmd-muted vcc-dl-note">
                  {slip.issues.length > 0 && <>Sự cố: {slip.issues.join('; ')}. </>}{slip.nextDayPlan && <>Kế hoạch mai: {slip.nextDayPlan}</>}</p>}
              </article>
            );
          })}
        </section>
      ))}
      {error && <ul className="vcc-mr-problems" role="alert"><li><AlertTriangle size={12} aria-hidden="true" /> {error}</li></ul>}
      <div className="vcc-cmd-actions">
        <button type="button" className="vcc-btn" data-pri="true" onClick={() => void create()} disabled={locked || !chosen.length}>
          {locked ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {locked ? `Đang tạo ${progress}/${chosen.length}…` : `Tạo ${chosen.length} phiếu nháp`}</button>
        <button type="button" className="vcc-btn" onClick={() => setAttempt(n => n + 1)} disabled={locked}><RotateCcw size={14} /> Đọc lại</button>
        <button type="button" className="vcc-btn" onClick={onCancel} disabled={locked || busyCancel}><X size={14} /> Bỏ</button>
      </div>
      <p className="vcc-cmd-note">Phiếu là nháp: mở phiếu điền khối lượng / % rồi gửi — chưa ghi gì tới khi {you} bấm.</p>
    </div>
  );
};

export default AssistantDailyLogForm;
