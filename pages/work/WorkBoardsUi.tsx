import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, Clock3, FileText, Loader2, MessageSquare, PenLine, X } from "lucide-react";
import type { WorkBoardService, WorkDirective, WorkOverviewState, WorkOverviewTask, WorkReviewItem, WorkTeamMember } from "../../lib/work/workBoardService";
import { WORK_LEVEL_LABELS, ontimeRate } from "../../lib/work/workBoardService";
import { workDayLabel, workDueInfo, workUpdateInfo } from "../../lib/work/workPresentation";
import { workError } from "../../lib/work/workForm";
import { directiveSource } from "../../lib/work/workBoards";
import { localIsoDate } from "../../lib/work/workAiText";

const CAP = 10;

/** Ô số bấm được (giống Việc của tôi). */
export function BoardKpi({ tone, icon, label, value, sub, onClick, pressed, title }: {
  tone: string; icon: React.ReactNode; label: string; value: React.ReactNode; sub: React.ReactNode; onClick?: () => void; pressed?: boolean; title?: string;
}) {
  const inner = <>
    <span className="work-kpi-icon" aria-hidden="true">{icon}</span>
    <span><span className="work-kpi-label">{label}</span><b className="work-kpi-value">{value}</b><span className="work-kpi-sub">{sub}</span></span>
  </>;
  return onClick
    ? <button type="button" className={`work-kpi tone-${tone}`} aria-pressed={pressed} onClick={onClick} title={title}>{inner}</button>
    : <div className={`work-kpi tone-${tone}`}>{inner}</div>;
}

export const rateText = (rate: number | null) => (rate == null ? "—" : `${rate}%`);
/** "+5 điểm so với tuần 41"; kỳ trước chưa có số thì nói rõ (không che bằng 0). */
export const DeltaText = ({ delta, vs }: { delta: number | null; vs: string }) => delta == null
  ? <>{vs} chưa có số</>
  : <><span className={delta >= 0 ? "work-up" : "work-down"}>{delta >= 0 ? "+" : ""}{delta} điểm</span> so với {vs}</>;

/** Ngăn chi tiết bên phải (toàn màn hình trên điện thoại), có Quay lại để đi Phòng → Người → Việc; Esc đóng. */
export interface DrawerView { key: string; title: string; sub?: string; body: React.ReactNode; foot?: React.ReactNode }
export function BoardDrawer({ stack, onBack, onClose }: { stack: DrawerView[]; onBack: () => void; onClose: () => void }) {
  const view = stack[stack.length - 1];
  useEffect(() => {
    if (!view) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [view, onClose]);
  if (!view) return null;
  return (
    <div className="work-bdrawer" role="dialog" aria-modal="true" aria-label={view.title}>
      <button type="button" className="work-bdrawer-scrim" aria-label="Đóng" onClick={onClose} />
      <section className="work-bdrawer-panel">
        <header>
          {stack.length > 1 && <button type="button" className="work-icon-button" aria-label="Quay lại" onClick={onBack}><ArrowLeft size={18} /></button>}
          <div><h2>{view.title}</h2>{view.sub && <p>{view.sub}</p>}</div>
          <button type="button" className="work-icon-button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="work-bdrawer-body" key={view.key}>{view.body}</div>
        {view.foot && <footer>{view.foot}</footer>}
      </section>
    </div>
  );
}

/** Một việc gọn trong danh sách đi sâu: mức, tên (mở chi tiết), người làm, hạn, tiến độ, lâu chưa cập nhật. */
export function TaskLine({ t, to, showPeople = true }: { t: WorkOverviewTask; to: string; showPeople?: boolean }) {
  const due = workDueInfo(t.deadlineAt, t.status);
  const upd = workUpdateInfo(t.lastProgressAt, t.status);
  return (
    <Link to={to} className={`work-tline work-level-row level-${t.level}`}>
      <span className={`work-level-chip level-${t.level}`} title={WORK_LEVEL_LABELS[t.level]}>{t.level}</span>
      <span className="work-tline-main">
        <b>{t.title}</b>
        <span className="work-tline-meta">
          {showPeople && t.assignees.length > 0 && <span>{t.assignees.map((a) => a.name).join(", ")}</span>}
          {t.completedAt && t.ontime != null
            ? <span className={`work-pill tone-${t.ontime ? "ok" : "rose"}`}>{t.ontime ? "Xong đúng hạn" : "Xong trễ"} {workDayLabel(t.completedAt)}</span>
            : <span className={`work-due tone-${due.tone}`}><Clock3 size={12} aria-hidden="true" /> {due.text}</span>}
          {!t.completedAt && <span className="work-row-progress"><span><i style={{ width: `${t.progressPercent}%` }} /></span><b>{t.progressPercent}%</b></span>}
          {upd?.stale && <span className="work-stale">{upd.text}</span>}
        </span>
      </span>
    </Link>
  );
}

/** Danh sách việc tải theo bộ lọc (người / đơn vị / trạng thái) — dùng cho ô số và người trong ngăn chi tiết. */
export function TaskListLoader({ board, filter, detailTo, showPeople = true, empty = "Không có việc." }: {
  board: Pick<WorkBoardService, "tasksOverview">;
  filter: { assigneeUserId?: string | null; unit?: string | null; state: WorkOverviewState; dueFrom?: string | null; dueBefore?: string | null };
  detailTo: (code: string) => string; showPeople?: boolean; empty?: string;
}) {
  const [items, setItems] = useState<WorkOverviewTask[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setItems(null); setError(null);
    board.tasksOverview({ ...filter, limit: 60 }).then((r) => { if (live) setItems(r.items || []); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [board, filter.assigneeUserId, filter.unit, filter.state, filter.dueFrom, filter.dueBefore, retry]);
  if (error) return <p className="work-error" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setRetry((v) => v + 1)}>Thử lại</button></p>;
  if (!items) return <p className="work-hint" role="status"><Loader2 size={14} className="work-spin" /> Đang tải việc…</p>;
  if (!items.length) return <p className="work-hint">{empty}</p>;
  return <div className="work-tlines">{items.map((t) => <TaskLine key={t.id} t={t} to={detailTo(t.code)} showPeople={showPeople} />)}</div>;
}

/** Ô thống kê nhỏ trong ngăn chi tiết. */
export const MiniStats = ({ items }: { items: Array<[string, React.ReactNode, string?]> }) => (
  <dl className="work-mini">{items.map(([label, value, tone]) => <div key={label}><dt>{label}</dt><dd className={tone ? `tone-${tone}` : ""}>{value}</dd></div>)}</dl>
);

/** Ngăn một người: số + việc đang làm (theo quyền xem); có kỳ thì thêm việc đến hạn trong kỳ. */
export function personView(m: WorkTeamMember, unitName: string, board: Pick<WorkBoardService, "tasksOverview">, detailTo: (code: string) => string,
  foot?: React.ReactNode, period?: { from: string; to: string; label: string }): DrawerView {
  return {
    key: `p-${m.userId}`, title: m.name, sub: [m.title, unitName].filter(Boolean).join(" · "),
    body: <>
      <MiniStats items={[["Đang làm", m.active], ["Quá hạn", m.overdue, m.overdue ? "rose" : undefined], ["Chưa cập nhật", m.stale, m.stale ? "amber" : undefined],
        ["Đúng hạn", rateText(ontimeRate(m.ontime, m.due))], ["Tải", `${m.load}/${CAP}`]]} />
      <h3 className="work-my-group-h">Việc đang làm</h3>
      <TaskListLoader board={board} filter={{ assigneeUserId: m.userId, state: "open" }} detailTo={detailTo} showPeople={false} empty="Không có việc đang làm." />
      {period && m.due > 0 && <>
        <h3 className="work-my-group-h">Đến hạn {period.label} <span className="work-count">{m.due}</span></h3>
        <TaskListLoader board={board} filter={{ assigneeUserId: m.userId, state: "due", dueFrom: period.from, dueBefore: period.to }} detailTo={detailTo} showPeople={false} />
      </>}
    </>,
    foot,
  };
}

/** Bảng người của một đơn vị: đang làm (A/B/C), quá hạn, chưa cập nhật, đúng hạn tuần, tải. Bấm một người để xem việc. */
export function MemberTable({ members, onPick }: { members: WorkTeamMember[]; onPick: (m: WorkTeamMember) => void }) {
  if (!members.length) return <p className="work-hint">Chưa có nhân viên trong đơn vị (theo Sơ đồ tổ chức).</p>;
  const mix = (m: WorkTeamMember) => {
    const tot = m.levels.A + m.levels.B + m.levels.C || 1;
    return <span className="work-mix" title={`A ${m.levels.A} · B ${m.levels.B} · C ${m.levels.C}`}>
      <i className="level-A" style={{ width: `${(m.levels.A / tot) * 100}%` }} /><i className="level-B" style={{ width: `${(m.levels.B / tot) * 100}%` }} />
      <i className="level-C" style={{ width: `${(m.levels.C / tot) * 100}%` }} /></span>;
  };
  return (
    <div className="work-members" role="table" aria-label="Nhân viên">
      <div className="work-members-h" role="row">
        <span role="columnheader">Người</span><span role="columnheader">Đang làm</span><span role="columnheader">Quá hạn</span>
        <span role="columnheader">Chưa cập nhật</span><span role="columnheader">Đúng hạn</span><span role="columnheader">Tải</span>
      </div>
      {members.map((m) => {
        const rate = ontimeRate(m.ontime, m.due);
        return (
          <button type="button" key={m.userId} className="work-members-r" role="row" onClick={() => onPick(m)}>
            <span className="work-members-who" role="cell"><span className="work-av" aria-hidden="true">{m.name.split(" ").pop()?.[0] || "?"}</span>
              <span><b>{m.name}{m.isHead && <em> · Trưởng</em>}</b><small>{m.title || ""}</small></span></span>
            <span role="cell" data-label="Đang làm"><b className="work-num">{m.active}</b>{mix(m)}</span>
            <span role="cell" data-label="Quá hạn">{m.overdue ? <span className="work-pill tone-rose">{m.overdue}</span> : <span className="work-muted">0</span>}</span>
            <span role="cell" data-label="Chưa cập nhật">{m.stale ? <span className="work-pill tone-amber">{m.stale}</span> : <span className="work-muted">0</span>}</span>
            <span role="cell" data-label="Đúng hạn"><b className="work-num">{rateText(rate)}</b><small>{m.due ? `${m.ontime}/${m.due} việc` : "chưa có việc đến hạn"}</small></span>
            <span role="cell" data-label="Tải"><span className="work-my-bar"><i className={m.load >= CAP ? "is-full" : ""} style={{ width: `${Math.min(100, (m.load / CAP) * 100)}%` }} /></span>
              <small className="work-num">{m.load}/{CAP}</small></span>
          </button>
        );
      })}
    </div>
  );
}

/** Một dòng Sổ chỉ đạo; người giao được nêu tên thì Xác nhận / Sửa hạn rồi xác nhận / Không phải tôi giao. */
export function DirectiveItem({ d, to, onDecide }: {
  d: WorkDirective; to: string;
  onDecide?: (d: WorkDirective, decision: "confirm" | "reject", note: string | null, deadlineAt: string | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<null | "due" | "reject">(null);
  const [date, setDate] = useState(d.deadlineAt ? localIsoDate(new Date(d.deadlineAt)) : localIsoDate(new Date(Date.now() + 3 * 86_400_000)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const due = d.bucket === "done" && d.completedAt ? { text: `Xong ${workDayLabel(d.completedAt)}`, tone: "ok" } : workDueInfo(d.deadlineAt, d.status);
  const upd = workUpdateInfo(d.lastProgressAt, d.status);
  const run = async (decision: "confirm" | "reject", n: string | null, deadline: string | null) => {
    if (!onDecide) return;
    setBusy(true); setError("");
    try { await onDecide(d, decision, n, deadline); setMode(null); } catch (e) { setError(workError(e)); } finally { setBusy(false); }
  };
  return (
    <article className={`work-dir work-level-row level-${d.level}`}>
      <div className="work-dir-t">
        <span className={`work-level-chip level-${d.level}`}>{d.level}</span>
        <Link to={to}>{d.title}</Link>
      </div>
      <div className="work-dir-m">
        {d.assignees.length > 0 && <span className="work-dir-who">{d.assignees.map((a) => `${a.name}${a.unit ? ` · ${a.unit}` : ""}`).join(", ")}</span>}
        <span className={`work-src is-${d.origin === "oral_claim" ? "oral" : "directive"}`}>
          {d.origin === "oral_claim" ? <PenLine size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />} {directiveSource(d)}</span>
        <span className={`work-due tone-${due.tone}`}><Clock3 size={12} aria-hidden="true" /> {due.text}</span>
        {d.bucket !== "confirm" && <span className="work-row-progress"><span><i style={{ width: `${d.progressPercent}%` }} /></span><b>{d.progressPercent}%</b></span>}
        {upd?.stale && <span className="work-stale">{upd.text}</span>}
      </div>
      {d.canDecide && onDecide && (mode === "due" ? (
        <form className="work-dir-a" onSubmit={(e) => { e.preventDefault(); const at = new Date(`${date}T17:00:00`); void run("confirm", null, at.toISOString()); }}>
          <input className="work-input" type="date" aria-label="Hạn mới" value={date} min={localIsoDate(new Date())} onChange={(e) => setDate(e.target.value)} />
          <button className="work-primary" disabled={busy || !date}>{busy && <Loader2 size={14} className="work-spin" />} Lưu hạn và xác nhận</button>
          <button type="button" className="work-secondary" onClick={() => setMode(null)}>Hủy</button>
        </form>
      ) : mode === "reject" ? (
        <form className="work-dir-a" onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) void run("reject", note, null); }}>
          <input className="work-input" autoFocus aria-label="Lý do" placeholder="Lý do (bắt buộc)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="work-primary" disabled={busy || note.trim().length < 3}>Gửi</button>
          <button type="button" className="work-secondary" onClick={() => setMode(null)}>Hủy</button>
        </form>
      ) : (
        <div className="work-dir-a">
          <button type="button" className="work-primary" disabled={busy} onClick={() => void run("confirm", null, null)}><Check size={15} /> Xác nhận</button>
          <button type="button" className="work-secondary" disabled={busy} onClick={() => setMode("due")}>Sửa hạn</button>
          <button type="button" className="work-text-button" disabled={busy} onClick={() => setMode("reject")}>Không phải tôi giao</button>
        </div>
      ))}
      {error && <p className="work-error" role="alert">{error}</p>}
    </article>
  );
}

/** Một việc chờ tôi duyệt: người nộp, lần nộp, hạn, kết quả tóm tắt; Duyệt / Trả lại (lý do) / Xem. */
export function ReviewItem({ r, to, onReview }: {
  r: WorkReviewItem; to: string; onReview: (r: WorkReviewItem, decision: "approve" | "request_changes", reason: string | null) => Promise<void>;
}) {
  const [ret, setRet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const due = workDueInfo(r.deadlineAt, "awaiting_review");
  const run = async (decision: "approve" | "request_changes", reason: string | null) => {
    setBusy(true); setError("");
    try { await onReview(r, decision, reason); setRet(null); } catch (e) { setError(workError(e)); } finally { setBusy(false); }
  };
  return (
    <article className={`work-dir work-level-row level-${r.level}`}>
      <div className="work-dir-t"><span className={`work-level-chip level-${r.level}`}>{r.level}</span><Link to={to}>{r.title}</Link></div>
      <div className="work-dir-m">
        <span className="work-dir-who">{r.assignees.join(", ")}</span>
        {r.iteration != null && <span>Nộp lần {r.iteration}</span>}
        <span className={`work-due tone-${due.tone}`}><Clock3 size={12} aria-hidden="true" /> {due.text}</span>
        {r.files > 0 && <span><FileText size={12} aria-hidden="true" /> {r.files} tệp</span>}
      </div>
      {r.result && <p className="work-dir-result">“{r.result}”</p>}
      {ret === null ? (
        <div className="work-dir-a">
          <button type="button" className="work-primary" disabled={busy} onClick={() => void run("approve", null)}>{busy ? <Loader2 size={14} className="work-spin" /> : <Check size={15} />} Duyệt</button>
          <button type="button" className="work-secondary" disabled={busy} onClick={() => setRet("")}>Trả lại</button>
          <Link className="work-text-button" to={to}>Xem</Link>
        </div>
      ) : (
        <form className="work-dir-a" onSubmit={(e) => { e.preventDefault(); if (ret.trim().length >= 3) void run("request_changes", ret); }}>
          <input className="work-input" autoFocus aria-label="Lý do trả lại" placeholder="Cần sửa gì? (bắt buộc)" maxLength={1000} value={ret} onChange={(e) => setRet(e.target.value)} />
          <button className="work-primary" disabled={busy || ret.trim().length < 3}>Gửi</button>
          <button type="button" className="work-secondary" onClick={() => setRet(null)}>Hủy</button>
        </form>
      )}
      {error && <p className="work-error" role="alert">{error}</p>}
    </article>
  );
}

export const NoHeadWarning = () => (
  <div className="work-warn-box"><AlertTriangle size={18} aria-hidden="true" /><div><b>Chưa gán trưởng bộ phận trên Sơ đồ tổ chức</b>
    <span>Chưa có người xem Phòng tôi, duyệt kết quả và được báo việc lâu chưa cập nhật cho đơn vị này.</span></div></div>
);
