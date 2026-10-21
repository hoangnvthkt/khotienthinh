import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Paperclip, PenLine, Send, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { WorkCollaborationCommand, WorkTask, WorkTaskAttachment } from "../../lib/work/workTypes";
import type { WorkBoardService, WorkTaskBrief, WorkTaskUpdate } from "../../lib/work/workBoardService";
import { normalizeProgressReport, PROGRESS_REPORT_PROBLEMS } from "../../lib/work/workBoardService";
import { workDayLabel } from "../../lib/work/workPresentation";
import { workError } from "../../lib/work/workForm";
import { workBriefFacts, workUpdateFacts, type WorkAiService } from "../../lib/work/workAi";
import { WorkTaskSection } from "./WorkTaskSection";

const STEPS = [25, 50, 75, 90, 100];
/** App dùng HashRouter: không dùng liên kết "#…" để cuộn (sẽ đổi trang), cuộn bằng mã. */
export const scrollToAttachments = () => document.getElementById("work-attachments")?.scrollIntoView({ behavior: "smooth", block: "start" });
/** Mốc % để bấm: giữ nguyên mức hiện tại + các mốc lớn hơn (+ mức AI gợi ý nếu có). */
export const progressChoices = (current: number, extra: number | null = null) =>
  [...new Set([current, ...STEPS.filter((s) => s > current), ...(extra != null ? [extra] : [])])].sort((a, b) => a - b);

/** Tệp người làm vừa tải sau lần cập nhật trước → gợi ý gắn vào lần cập nhật này. */
export const freshAttachments = (files: WorkTaskAttachment[], actorId: string, since: string | null) =>
  files.filter((f) => f.uploader_user_id === actorId && !f.deleted_at && (!since || f.created_at > since));

export function WorkProgressComposer({ task, attachments, actorId, lastUpdateAt, busy, run, onBlock, ai, brief = null }: {
  task: WorkTask;
  /** Đợt 1 PR-3: "Viết giúp" — ghi chú lộn xộn → Đã / Đang / Sẽ / Vướng (+ % khi ghi chú nói rõ). */
  ai?: WorkAiService;
  brief?: WorkTaskBrief | null;
  attachments: WorkTaskAttachment[];
  actorId: string;
  lastUpdateAt: string | null;
  busy: boolean;
  run: (input: WorkCollaborationCommand) => Promise<boolean>;
  /** Có ghi Vướng: hỏi người làm có chuyển việc sang trạng thái Vướng (lệnh block) không. */
  onBlock: (reason: string) => Promise<boolean>;
}) {
  const [done, setDone] = useState("");
  const [doing, setDoing] = useState("");
  const [next, setNext] = useState("");
  const [blocked, setBlocked] = useState("");
  const [percent, setPercent] = useState(task.progress_percent);
  const fresh = useMemo(() => freshAttachments(attachments, actorId, lastUpdateAt), [attachments, actorId, lastUpdateAt]);
  const [picked, setPicked] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const [askBlock, setAskBlock] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpNote, setHelpNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [aiRunId, setAiRunId] = useState<string | null>(null);
  const [aiPercent, setAiPercent] = useState<number | null>(null);
  useEffect(() => { setPercent(task.progress_percent); }, [task.id, task.progress_percent]);
  useEffect(() => { setPicked(fresh.map((f) => f.id)); }, [fresh.map((f) => f.id).join(",")]);

  async function splitNotes() {
    if (!ai) return;
    if (notes.trim().length < 3) { setHelpNote({ tone: "warn", text: "Gõ vài ý đã làm / đang làm / vướng gì trước." }); return; }
    setHelpBusy(true); setHelpNote(null);
    const r = await ai.updateDraft(notes.trim(), workUpdateFacts(task, brief), task.id);
    setHelpBusy(false);
    if (!r.ok) { setHelpNote({ tone: "warn", text: `${r.message} Bạn vẫn ghi tay được.` }); return; }
    setDone(r.result.done); setDoing(r.result.doing); setNext(r.result.next); setBlocked(r.result.blocked);
    if (r.result.percent != null) { setPercent(r.result.percent); setAiPercent(r.result.percent); }
    setAiRunId(r.runId); setHelpOpen(false); setNotes("");
    setHelpNote({ tone: r.result.warnings.length ? "warn" : "ok",
      text: `AI đã chia vào Đã / Đang / Sẽ / Vướng${r.result.percent != null ? ` · ${r.result.percent}%` : ""}${r.result.warnings.length ? ` · ${r.result.warnings[0]}` : ""}. Sửa nếu cần rồi bấm Gửi.` });
  }

  async function send() {
    const input = { done, doing, next, blocked, progressPercent: percent, attachmentIds: picked, expectedLockVersion: task.lock_version, aiRunId };
    const normalized = normalizeProgressReport(input);
    if ("problem" in normalized) { setProblem(PROGRESS_REPORT_PROBLEMS[normalized.problem]); return; }
    setProblem("");
    const ok = await run({ command: "progress_report", payload: normalized.payload as Extract<WorkCollaborationCommand, { command: "progress_report" }>["payload"] });
    if (!ok) return;
    const reason = blocked.trim();
    setDone(""); setDoing(""); setNext(""); setBlocked(""); setAiRunId(null); setAiPercent(null); setHelpNote(null);
    if (reason && task.status !== "blocked") setAskBlock(reason);
  }

  return (
    <WorkTaskSection className="work-report" title="Cập nhật tiến độ" actions={<>
      {ai && (
        <button type="button" className="work-text-button work-ai-inline" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}
          title="Gõ / dán ghi chú, AI chia vào Đã – Đang – Sẽ – Vướng">
          <Sparkles size={13} /> Viết giúp
        </button>
      )}
      <span className="work-report-percent">{task.progress_percent}%</span>
    </>}>
      {helpOpen && (
        <div className="work-report-help">
          <textarea className="work-input" rows={3} maxLength={3000} value={notes} aria-label="Ghi chú nhanh"
            placeholder="Gõ / dán ghi chú lộn xộn cũng được, VD: xong bóc KL móng, đang làm dầm, mai đối chiếu dự toán, chờ CĐT duyệt bản vẽ, được tầm 60%"
            onChange={(e) => setNotes(e.target.value)} />
          <button type="button" className="work-secondary work-ai-button" disabled={helpBusy} onClick={() => void splitNotes()}>
            {helpBusy ? <Loader2 size={15} className="work-spin" /> : <Sparkles size={15} />} {helpBusy ? "AI đang chia…" : "Chia giúp"}
          </button>
        </div>
      )}
      {helpNote && <p className={`work-ai-note is-${helpNote.tone}`} role="status"><Sparkles size={14} aria-hidden="true" /> <span>{helpNote.text}</span></p>}
      <div className="work-report-grid">
        <label className="work-label">Đã làm<textarea className="work-input" rows={2} maxLength={2000} value={done} placeholder="Xong gì từ lần trước" onChange={(e) => setDone(e.target.value)} /></label>
        <label className="work-label">Đang làm<textarea className="work-input" rows={2} maxLength={2000} value={doing} placeholder="Đang làm gì" onChange={(e) => setDoing(e.target.value)} /></label>
        <label className="work-label">Sẽ làm<textarea className="work-input" rows={2} maxLength={2000} value={next} placeholder="Bước tiếp, ngày nào" onChange={(e) => setNext(e.target.value)} /></label>
      </div>
      <label className="work-label work-report-blocked">Vướng<input className="work-input" maxLength={2000} value={blocked} placeholder="Để trống nếu không vướng" onChange={(e) => setBlocked(e.target.value)} /></label>
      <div className="work-report-foot">
        <div className="work-quick-seg" role="group" aria-label="Phần trăm hoàn thành">
          {progressChoices(task.progress_percent, aiPercent).map((value) => (
            <button type="button" key={value} aria-pressed={percent === value} onClick={() => setPercent(value)}>{value}%</button>
          ))}
        </div>
        <button type="button" className="work-secondary work-report-attach" onClick={scrollToAttachments}
          title="Tải ảnh / tệp ở mục Đính kèm; tệp mới tải sẽ tự gắn vào lần cập nhật này">
          <Paperclip size={15} /> Ảnh / tệp
        </button>
        {fresh.length > 0 && (
          <div className="work-report-files" aria-label="Tệp gắn vào lần cập nhật">
            {fresh.map((f) => (
              <button type="button" key={f.id} aria-pressed={picked.includes(f.id)}
                onClick={() => setPicked((ids) => (ids.includes(f.id) ? ids.filter((id) => id !== f.id) : [...ids, f.id]))}>
                {f.file_name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="work-primary work-report-send" disabled={busy} onClick={() => void send()}>
          <Send size={15} /> Gửi cập nhật
        </button>
      </div>
      {problem && <p className="work-error" role="alert">{problem}</p>}
      {askBlock && (
        <div className="work-notice work-report-askblock" role="status">
          <AlertTriangle size={16} aria-hidden="true" /> Chuyển việc sang <b>Vướng</b> để người giao thấy ngay?
          <button type="button" className="work-primary" disabled={busy}
            onClick={() => void onBlock(askBlock).then((ok) => ok && setAskBlock(null))}>Chuyển sang Vướng</button>
          <button type="button" className="work-secondary" onClick={() => setAskBlock(null)}>Không</button>
        </div>
      )}
    </WorkTaskSection>
  );
}

export function WorkUpdateTimeline({ taskId, board, refreshKey }: {
  taskId: string;
  board: Pick<WorkBoardService, "listUpdates">;
  /** Đổi khi chi tiết việc tải lại (sau mỗi lệnh / realtime). */
  refreshKey: unknown;
}) {
  const [items, setItems] = useState<WorkTaskUpdate[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    board.listUpdates(taskId).then((page) => {
      if (!live) return;
      setItems(page.items); setNextBefore(page.nextBefore);
    }).catch((caught) => live && setError(caught));
    return () => { live = false; };
  }, [taskId, board, refreshKey, retry]);

  async function more() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await board.listUpdates(taskId, nextBefore);
      setItems((old) => [...(old || []), ...page.items.filter((item) => !(old || []).some((o) => o.id === item.id))]);
      setNextBefore(page.nextBefore);
    } catch (caught) { setError(caught); } finally { setLoadingMore(false); }
  }

  return (
    <WorkTaskSection className="work-updates" title="Dòng cập nhật" actions={items ? <span className="work-count">{items.length}{nextBefore ? "+" : ""}</span> : undefined}>
      {error && <p className="work-error" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setRetry((v) => v + 1)}>Thử lại</button></p>}
      {!items && !error && <p className="work-hint" role="status">Đang tải cập nhật…</p>}
      {items && items.length === 0 && <p className="work-hint">Chưa có cập nhật.</p>}
      {items && items.length > 0 && (
        <ol className="work-updates-list">
          {items.map((u) => (
            <li key={u.id}>
              <span className={`work-updates-dot${u.blocked ? " is-blocked" : ""}`} aria-hidden="true">{u.blocked ? <AlertTriangle size={14} /> : <PenLine size={14} />}</span>
              <div className="work-updates-body">
                <p className="work-updates-head">
                  <b>{u.authorName}</b>
                  {u.progressAfter !== u.progressBefore
                    ? <span className="work-updates-pct">{u.progressBefore}% → {u.progressAfter}%</span>
                    : <span className="work-updates-pct is-same">{u.progressAfter}%</span>}
                  <time dateTime={u.at}>{workDayLabel(u.at)}</time>
                  {u.ai && <span className="work-updates-ai" title="Người làm dùng bản nháp AI rồi tự gửi"><Sparkles size={12} /> AI soạn</span>}
                </p>
                <dl className="work-updates-dl">
                  {u.done && <><dt>Đã làm</dt><dd>{u.done}</dd></>}
                  {u.doing && <><dt>Đang làm</dt><dd>{u.doing}</dd></>}
                  {u.next && <><dt>Sẽ làm</dt><dd>{u.next}</dd></>}
                  {u.blocked && <><dt>Vướng</dt><dd className="is-blocked">{u.blocked}</dd></>}
                </dl>
                {u.files.length > 0 && (
                  <p className="work-updates-files">{u.files.map((f) => <button type="button" key={f.id} onClick={scrollToAttachments}><Paperclip size={12} /> {f.name}</button>)}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {nextBefore && <button className="work-secondary" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "Đang tải…" : "Xem cập nhật cũ hơn"}</button>}
    </WorkTaskSection>
  );
}

/** Đợt 1 PR-3 · Tóm tắt một việc (người giao / BLĐ): AI viết 2–3 câu từ số liệu của chính việc này; kịp hạn do máy tính. */
export function WorkAiBrief({ brief, taskId, ai }: { brief: WorkTaskBrief | null; taskId: string; ai: WorkAiService }) {
  const [state, setState] = useState<{ busy: boolean; text: string | null; runId: string | null; error: string | null; rated: boolean | null }>(
    { busy: false, text: null, runId: null, error: null, rated: null });
  useEffect(() => { setState({ busy: false, text: null, runId: null, error: null, rated: null }); }, [taskId]);
  async function summarize() {
    if (!brief) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    const r = await ai.briefTask(workBriefFacts(brief), taskId);
    setState(r.ok ? { busy: false, text: r.result.brief, runId: r.runId, error: null, rated: null } : { busy: false, text: null, runId: null, error: r.message, rated: null });
  }
  const rate = (accepted: boolean) => { if (state.runId) ai.feedback(state.runId, accepted); setState((s) => ({ ...s, rated: accepted })); };
  if (!state.text) {
    return (
      <div className="work-ai-brief is-idle">
        <button type="button" className="work-secondary work-ai-button" disabled={!brief || state.busy} onClick={() => void summarize()}
          title="AI tóm tắt việc đang ở đâu, vướng gì, có kịp hạn không — từ số liệu của việc này">
          {state.busy ? <Loader2 size={15} className="work-spin" /> : <Sparkles size={15} />} {state.busy ? "AI đang tóm tắt…" : "Tóm tắt việc này"}
        </button>
        {state.error && <span className="work-error" role="alert">{state.error}</span>}
      </div>
    );
  }
  return (
    <div className="work-ai-brief" role="status">
      <p><Sparkles size={14} aria-hidden="true" /> {state.text}</p>
      <div className="work-ai-brief-foot">
        <span>AI tóm tắt từ số liệu của việc · kịp hạn do máy tính</span>
        {state.rated == null ? (
          <>
            <button type="button" className="work-icon-button" aria-label="Tóm tắt đúng" onClick={() => rate(true)}><ThumbsUp size={14} /></button>
            <button type="button" className="work-icon-button" aria-label="Tóm tắt chưa đúng" onClick={() => rate(false)}><ThumbsDown size={14} /></button>
          </>
        ) : <span>{state.rated ? "Cảm ơn bạn" : "Đã ghi nhận"}</span>}
        <button type="button" className="work-text-button" disabled={state.busy} onClick={() => void summarize()}>Tóm tắt lại</button>
      </div>
    </div>
  );
}
