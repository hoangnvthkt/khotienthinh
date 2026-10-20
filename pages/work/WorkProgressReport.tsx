import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Paperclip, PenLine, Send, Sparkles } from "lucide-react";
import type { WorkCollaborationCommand, WorkTask, WorkTaskAttachment } from "../../lib/work/workTypes";
import type { WorkBoardService, WorkTaskUpdate } from "../../lib/work/workBoardService";
import { normalizeProgressReport, PROGRESS_REPORT_PROBLEMS } from "../../lib/work/workBoardService";
import { workDayLabel } from "../../lib/work/workPresentation";
import { workError } from "../../lib/work/workForm";
import { WorkTaskSection } from "./WorkTaskSection";

const STEPS = [25, 50, 75, 90, 100];
/** App dùng HashRouter: không dùng liên kết "#…" để cuộn (sẽ đổi trang), cuộn bằng mã. */
export const scrollToAttachments = () => document.getElementById("work-attachments")?.scrollIntoView({ behavior: "smooth", block: "start" });
/** Mốc % để bấm: giữ nguyên mức hiện tại + các mốc lớn hơn. */
export const progressChoices = (current: number) => [...new Set([current, ...STEPS.filter((s) => s > current)])].sort((a, b) => a - b);

/** Tệp người làm vừa tải sau lần cập nhật trước → gợi ý gắn vào lần cập nhật này. */
export const freshAttachments = (files: WorkTaskAttachment[], actorId: string, since: string | null) =>
  files.filter((f) => f.uploader_user_id === actorId && !f.deleted_at && (!since || f.created_at > since));

export function WorkProgressComposer({ task, attachments, actorId, lastUpdateAt, busy, run, onBlock }: {
  task: WorkTask;
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
  useEffect(() => { setPercent(task.progress_percent); }, [task.id, task.progress_percent]);
  useEffect(() => { setPicked(fresh.map((f) => f.id)); }, [fresh.map((f) => f.id).join(",")]);

  async function send() {
    const input = { done, doing, next, blocked, progressPercent: percent, attachmentIds: picked, expectedLockVersion: task.lock_version };
    const normalized = normalizeProgressReport(input);
    if ("problem" in normalized) { setProblem(PROGRESS_REPORT_PROBLEMS[normalized.problem]); return; }
    setProblem("");
    const ok = await run({ command: "progress_report", payload: normalized.payload as Extract<WorkCollaborationCommand, { command: "progress_report" }>["payload"] });
    if (!ok) return;
    const reason = blocked.trim();
    setDone(""); setDoing(""); setNext(""); setBlocked("");
    if (reason && task.status !== "blocked") setAskBlock(reason);
  }

  return (
    <WorkTaskSection className="work-report" title="Cập nhật tiến độ" actions={<span className="work-report-percent">{task.progress_percent}%</span>}>
      <div className="work-report-grid">
        <label className="work-label">Đã làm<textarea className="work-input" rows={2} maxLength={2000} value={done} placeholder="Xong gì từ lần trước" onChange={(e) => setDone(e.target.value)} /></label>
        <label className="work-label">Đang làm<textarea className="work-input" rows={2} maxLength={2000} value={doing} placeholder="Đang làm gì" onChange={(e) => setDoing(e.target.value)} /></label>
        <label className="work-label">Sẽ làm<textarea className="work-input" rows={2} maxLength={2000} value={next} placeholder="Bước tiếp, ngày nào" onChange={(e) => setNext(e.target.value)} /></label>
      </div>
      <label className="work-label work-report-blocked">Vướng<input className="work-input" maxLength={2000} value={blocked} placeholder="Để trống nếu không vướng" onChange={(e) => setBlocked(e.target.value)} /></label>
      <div className="work-report-foot">
        <div className="work-quick-seg" role="group" aria-label="Phần trăm hoàn thành">
          {progressChoices(task.progress_percent).map((value) => (
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
