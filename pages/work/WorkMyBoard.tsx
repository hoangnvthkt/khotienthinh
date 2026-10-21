import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock3, LayoutList, ListChecks, Loader2, MessageSquare, PenLine, Plus,
  User, UserCheck, UserRound,
} from "lucide-react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { WorkAssignablePerson, WorkBoardService, WorkLevel, WorkMyBoard as Board, WorkMyTask } from "../../lib/work/workBoardService";
import { WORK_LEVEL_LABELS, ontimeRate } from "../../lib/work/workBoardService";
import { WorkCreateAttempt, workDocument, workError } from "../../lib/work/workForm";
import { workDayLabel, workDueInfo, workUpdateInfo } from "../../lib/work/workPresentation";
import { dateAt, quickTaskInput } from "../../lib/work/workQuick";
import {
  MY_GROUP_LABELS, MY_RANGE_LABELS, ddmm, myBoardGroups, myDay, myNoDue, myOntime, myRangeDays, myShiftAnchor, mySource, myWeekDays, myWeekLabel, saturdayOf,
  type MyGroupId, type MyRange,
} from "../../lib/work/workMyBoard";
import { periodLabel, periodQuery, periodShort, prevShort } from "../../lib/work/workPeriod";
import { WorkPeriodPicker, useWorkPeriod } from "./WorkPeriodPicker";

const CAP = 10;
type Edit = { id: string; kind: "blocked" | "done"; text: string } | null;
type View = "calendar" | "list";
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const DOW_LABEL = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const dayTitle = (day: string) => `${DOW_LABEL[new Date(`${day}T00:00:00Z`).getUTCDay()]} ${ddmm(day)}`;
/** Lựa chọn riêng từng máy (Lịch / Danh sách, khoảng); trình duyệt chặn lưu thì dùng mặc định. */
const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : fallback; } catch { return fallback; }
};
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* bỏ qua */ } };
const isPhone = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px)").matches;

/** Việc của tôi (mockup v1 + Lịch, chủ SP 20/10/2026): nhìn lướt bằng màu, số, %; bấm ngày ra danh sách gọn, bấm việc ra chi tiết.
 *  Nút một chạm Đang làm / Vướng / Xong; ghi việc giao miệng. Công tắc Lịch | Danh sách nhớ theo máy. */
export function WorkMyBoard({ board, service, refreshKey, detailTo, onNotice, headerActions, children }: {
  board: Pick<WorkBoardService, "myBoard" | "assignablePeople" | "setOrigin">;
  service: Pick<WorkTaskService, "command" | "preview" | "create">;
  /** Đổi khi danh sách / realtime báo có thay đổi → tải lại. */
  refreshKey: unknown;
  detailTo: (code: string) => string;
  onNotice: (message: string) => void;
  headerActions?: React.ReactNode;
  /** Giao nhanh + tab danh sách (đặt giữa ô số và phần việc). */
  children?: React.ReactNode;
}) {
  const [period, setPeriod, localToday] = useWorkPeriod();
  const query = periodQuery(period, localToday);
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>(() => remembered("work.my.view", ["calendar", "list"] as const, "calendar"));
  const [range, setRange] = useState<MyRange>(() => remembered("work.my.range", ["week", "2weeks", "month"] as const, isPhone() ? "week" : "2weeks"));
  const [anchor, setAnchor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<MyGroupId | "all">("all");
  const [showDone, setShowDone] = useState(false);
  const [composer, setComposer] = useState(false);
  const [edit, setEdit] = useState<Edit>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    board.myBoard(query).then((b) => { if (live) setData(b); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [board, refreshKey, reload, query.from, query.to, query.prevFrom, query.prevTo]);

  const groups = useMemo(() => (data ? myBoardGroups(data.tasks, data.today, data.weekEnd, new Date(), data.weekStart) : null), [data]);
  const ontime = data ? myOntime(data.weeks) : null;
  const today = data?.today || null;
  const span = useMemo(() => (today ? myRangeDays(range, anchor || today) : null), [range, anchor, today]);
  const days = useMemo(() => (data && span ? span.days.map((d) => myDay(d, data.tasks)) : []), [data, span]);
  const noDue = useMemo(() => (data ? myNoDue(data.tasks) : []), [data]);
  const pick = selected || today;
  const picked = pick === "nodue" ? null : days.find((d) => d.day === pick) || (data && pick ? myDay(pick, data.tasks) : null);

  const chooseView = (v: View) => { setView(v); remember("work.my.view", v); };
  const chooseRange = (r: MyRange) => { setRange(r); remember("work.my.range", r); };
  const selectDay = (day: string) => {
    setSelected(day); setEdit(null);
    if (isPhone()) requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  /** Một chạm: nhận việc (nếu chưa) → bắt đầu / gỡ vướng → vướng / nộp. Mỗi lệnh kiểm phiên bản như màn chi tiết. */
  async function act(t: WorkMyTask, kind: "doing" | "blocked" | "done", text = "") {
    setBusy(t.id); setRowError(null);
    let lock = t.lockVersion; let status = t.status;
    const run = async (command: "acknowledge" | "start" | "unblock" | "block" | "submit", payload: Record<string, unknown> = {}) => {
      const r = await service.command({ taskId: t.id, command, payload, expectedLockVersion: lock, idempotencyKey: crypto.randomUUID() } as never);
      lock = r.lockVersion; status = r.status;
    };
    try {
      if (t.can.acknowledge) await run("acknowledge");
      if (kind !== "blocked" && status === "blocked") await run("unblock");
      if (status === "not_started" || (kind !== "done" && status === "changes_requested")) await run("start");
      if (kind === "blocked" && status === "in_progress") await run("block", { reason: text.trim() });
      if (kind === "done") await run("submit", { result: workDocument(text.trim()) });
      setEdit(null);
      onNotice(kind === "done" ? (t.needsReview ? `Đã nộp ${t.code} — chờ người giao duyệt` : `Đã hoàn thành ${t.code}`)
        : kind === "blocked" ? `Đã báo vướng ${t.code} — người giao thấy ngay` : `${t.code} đang làm`);
      setReload((v) => v + 1);
    } catch (e) {
      setRowError({ id: t.id, message: workError(e) });
      setReload((v) => v + 1);
    } finally { setBusy(null); }
  }

  if (error && !data) {
    return (
      <section className="work-my" aria-label="Việc của tôi">
        <p className="work-error" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setReload((v) => v + 1)}>Thử lại</button></p>
        {children}
      </section>
    );
  }
  if (!data || !groups || !ontime || !span) {
    return <section className="work-my" aria-label="Việc của tôi" aria-busy="true"><p className="work-hint" role="status"><Loader2 size={15} className="work-spin" /> Đang tải việc của bạn…</p>{children}</section>;
  }

  const row = (t: WorkMyTask) => (
    <TaskRow key={t.id} t={t} unitName={data.me.unit?.name || null} to={detailTo(t.code)} edit={edit} setEdit={setEdit} busy={busy === t.id}
      error={rowError?.id === t.id ? rowError.message : null} act={act} />
  );
  const sections = (Object.keys(MY_GROUP_LABELS) as MyGroupId[]).filter((id) => groups[id].length && (filter === "all" || filter === id));
  // Ô số: ở Lịch thì bấm để xem danh sách đúng nhóm đó; bấm lại để bỏ lọc.
  const kpi = (id: MyGroupId, tone: string, icon: React.ReactNode, label: string, value: number, sub: string) => (
    <button type="button" className={`work-kpi tone-${tone}`} aria-pressed={view === "list" && filter === id}
      onClick={() => { if (view === "list" && filter === id) setFilter("all"); else { setFilter(id); chooseView("list"); } }}
      title={view === "list" && filter === id ? "Bấm lại để xem tất cả" : `Xem danh sách ${label.toLowerCase()}`}>
      <span className="work-kpi-icon" aria-hidden="true">{icon}</span>
      <span><span className="work-kpi-label">{label}</span><b className="work-kpi-value">{value}</b><span className="work-kpi-sub">{sub}</span></span>
    </button>
  );
  const live = data.tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  // Đúng hạn theo kỳ đang chọn; máy chủ cũ chưa trả period thì dùng tuần trước như trước.
  const kpiOntime = data.period ? (() => {
    const rate = ontimeRate(data.period.ontime, data.period.due);
    const prev = data.period.prevDue == null ? null : ontimeRate(data.period.prevOntime || 0, data.period.prevDue);
    return { rate, due: data.period.due, ontime: data.period.ontime, delta: rate != null && prev != null ? rate - prev : null };
  })() : ontime;
  const attention = [...groups.over, ...groups.confirm];
  const canBack = !data.doneSince || span.from > data.doneSince;
  const stats = (
    <section className="work-my-card" aria-label="Số của tôi">
      <header><h2>Số của tôi</h2></header>
      <dl className="work-my-stats">
        <div><dt>Đúng hạn 4 tuần</dt><dd>
          <span className="work-my-spark" aria-hidden="true">{ontime.trend.map((r, i) => <i key={i} style={{ height: `${r == null ? 4 : Math.max(8, r)}%` }} className={r == null ? "is-empty" : ""} />)}</span>
          {ontime.rate == null ? "—" : `${ontime.rate}%`}</dd></div>
        <div><dt>Duyệt lần đầu</dt><dd>{data.review.reviewed ? `${Math.round((data.review.firstPass / data.review.reviewed) * 100)}%` : "—"}
          {data.review.reviewed > 0 && <small> {data.review.firstPass}/{data.review.reviewed}</small>}</dd></div>
        <div><dt>Tải việc</dt><dd>
          <span className="work-my-bar" aria-hidden="true"><i className={data.load >= CAP ? "is-full" : ""} style={{ width: `${Math.min(100, (data.load / CAP) * 100)}%` }} /></span>
          {data.load}/{CAP}{data.load >= CAP && <span className="work-pill tone-amber">Đầy</span>}</dd></div>
        <div><dt>Đang làm</dt><dd>{live.length} việc</dd></div>
      </dl>
    </section>
  );

  return (
    <section className="work-my" aria-label="Việc của tôi">
      <header className="work-my-head">
        <span className="work-my-icon" aria-hidden="true"><ClipboardList size={22} /></span>
        <div className="work-my-title">
          <h1>Việc của tôi</h1>
          <p>{[data.me.name, data.me.title, myWeekLabel(data)].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="work-my-actions">
          <WorkPeriodPicker period={period} today={localToday} onChange={setPeriod} />
          {headerActions}
          <button type="button" className="work-primary" aria-expanded={composer} onClick={() => setComposer((v) => !v)}>
            <Plus size={18} /> Ghi việc được giao
          </button>
        </div>
      </header>

      <div className="work-kpis">
        {kpi("over", "rose", <AlertTriangle size={18} />, "Quá hạn", groups.over.length, "cần xử lý ngay")}
        {kpi("today", "amber", <Clock3 size={18} />, "Hôm nay", groups.today.length, `đến hạn ${ddmm(data.today)}`)}
        {kpi("week", "sky", <ClipboardList size={18} />, "Tuần này", groups.week.length, `đến ${ddmm(data.weekEnd)}`)}
        {kpi("confirm", "amber", <PenLine size={18} />, "Chờ xác nhận", groups.confirm.length, "việc giao miệng")}
        <div className="work-kpi tone-ok" title={periodLabel(period)}>
          <span className="work-kpi-icon" aria-hidden="true"><Check size={18} /></span>
          <span>
            <span className="work-kpi-label">Đúng hạn {periodShort(period)}</span>
            <b className="work-kpi-value">{kpiOntime.rate == null ? "—" : `${kpiOntime.rate}%`}{kpiOntime.due > 0 && <small> {kpiOntime.ontime}/{kpiOntime.due}</small>}</b>
            <span className="work-kpi-sub">{kpiOntime.rate == null ? "chưa có việc đến hạn"
              : kpiOntime.delta == null ? `${prevShort(period)} chưa có số`
              : <><span className={kpiOntime.delta >= 0 ? "work-up" : "work-down"}>{kpiOntime.delta >= 0 ? "+" : ""}{kpiOntime.delta} điểm</span> so với {prevShort(period)}</>}</span>
          </span>
        </div>
      </div>

      {composer && <WorkClaimComposer board={board} service={service} me={data.me.userId} weekStart={data.weekStart}
        onCancel={() => setComposer(false)} onDone={(message) => { setComposer(false); onNotice(message); setReload((v) => v + 1); }} />}
      {children}

      <div className="work-my-toolbar">
        <div className="work-quick-seg" role="group" aria-label="Cách xem">
          <button type="button" aria-pressed={view === "calendar"} onClick={() => chooseView("calendar")}><CalendarDays size={15} /> Lịch</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => { chooseView("list"); setFilter("all"); }}><LayoutList size={15} /> Danh sách</button>
        </div>
        {view === "calendar" && <>
          <div className="work-my-nav">
            <button type="button" className="work-icon-button" aria-label="Khoảng trước" disabled={!canBack}
              title={canBack || !data.doneSince ? undefined : `Lịch chỉ xem lùi đến ${ddmm(data.doneSince)}`} onClick={() => setAnchor(myShiftAnchor(range, anchor || data.today, -1))}><ChevronLeft size={18} /></button>
            <b>{span.label}</b>
            <button type="button" className="work-icon-button" aria-label="Khoảng sau" onClick={() => setAnchor(myShiftAnchor(range, anchor || data.today, 1))}><ChevronRight size={18} /></button>
            {(anchor && !span.days.includes(data.today)) && <button type="button" className="work-text-button" onClick={() => { setAnchor(null); setSelected(null); }}>Hôm nay</button>}
          </div>
          <div className="work-quick-seg work-my-range" role="group" aria-label="Khoảng thời gian">
            {(Object.keys(MY_RANGE_LABELS) as MyRange[]).map((r) => <button type="button" key={r} aria-pressed={range === r} onClick={() => chooseRange(r)}>{MY_RANGE_LABELS[r]}</button>)}
          </div>
        </>}
      </div>

      {error && <p className="work-error" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setReload((v) => v + 1)}>Thử lại</button></p>}

      {view === "calendar" ? (
        <>
          {attention.length > 0 && (
            <section className="work-my-attention" aria-label="Cần xử lý">
              <h2 className="work-my-group-h">Cần xử lý <span className="work-count tone-over">{attention.length}</span></h2>
              <div className="work-my-list">{attention.map(row)}</div>
            </section>
          )}
          <div className="work-my-cols is-calendar">
            <div className="work-my-main">
              <div className={`work-my-cal range-${range}`} role="grid" aria-label={`Lịch việc · ${span.label}`}>
                {WEEKDAYS.map((w) => <span key={w} className="work-my-cal-dow" role="columnheader">{w}</span>)}
                {days.map((d) => {
                  const out = range === "month" && d.day.slice(0, 7) !== (anchor || data.today).slice(0, 7);
                  const sat = new Date(`${d.day}T00:00:00Z`).getUTCDay() === 6;
                  return (
                    <button type="button" key={d.day} role="gridcell" aria-pressed={pick === d.day}
                      className={`work-my-cell state-${d.state}${d.day === data.today ? " is-today" : ""}${out ? " is-out" : ""}`}
                      aria-label={`${dayTitle(d.day)}: ${d.count ? `${d.count} việc, ${d.percent}%${d.state === "late" ? ", có việc trễ" : d.state === "warn" ? ", có việc vướng hoặc lâu chưa cập nhật" : d.state === "done" ? ", đã xong hết" : ""}` : "không có việc đến hạn"}`}
                      onClick={() => selectDay(d.day)}>
                      <span className="work-my-cell-top"><span className="work-my-cell-day">{Number(d.day.slice(8, 10))}</span>{sat && <span className="work-my-cell-close" title="Chốt tuần">Chốt</span>}</span>
                      {d.count > 0 && <>
                        <b className="work-my-cell-count">{d.count}</b>
                        <span className="work-my-cell-dots" aria-hidden="true">{d.levels.slice(0, 5).map((l, i) => <i key={i} className={`level-${l}`} />)}</span>
                        <span className="work-my-cell-pct" aria-hidden="true"><span><i style={{ width: `${d.percent}%` }} /></span><small>{d.percent}%</small></span>
                      </>}
                    </button>
                  );
                })}
              </div>
              <p className="work-my-cal-legend" aria-hidden="true">
                <span><i className="state-late" /> Có việc trễ</span><span><i className="state-warn" /> Vướng / lâu chưa cập nhật</span>
                <span><i className="state-open" /> Đang làm</span><span><i className="state-done" /> Xong hết</span>
                {noDue.length > 0 && <button type="button" className="work-chip-button" aria-pressed={pick === "nodue"} onClick={() => selectDay("nodue")}>Chưa có hạn · {noDue.length}</button>}
              </p>
            </div>
            <aside className="work-my-side">
              <section className="work-my-card work-my-dayp" aria-label="Việc trong ngày" ref={panel}>
                <header><h2>{pick === "nodue" ? "Chưa có hạn" : pick ? dayTitle(pick) : ""}</h2>
                  <span>{pick === "nodue" ? `${noDue.length} việc` : picked?.count ? `${picked.count} việc · ${picked.percent}%` : ""}</span></header>
                <div className="work-my-list">
                  {pick === "nodue" ? noDue.map(row)
                    : picked && picked.count ? picked.tasks.map(row)
                    : <p className="work-my-dayp-empty"><CheckCircle2 size={16} aria-hidden="true" /> Không có việc đến hạn ngày này.</p>}
                </div>
              </section>
              {stats}
            </aside>
          </div>
        </>
      ) : (
        <div className="work-my-cols">
          <div className="work-my-main">
            {sections.length ? sections.map((id) => (
              <section key={id} className="work-my-group" aria-label={MY_GROUP_LABELS[id]}>
                <h2 className="work-my-group-h">{MY_GROUP_LABELS[id]} <span className={`work-count tone-${id}`}>{groups[id].length}</span></h2>
                <div className="work-my-list">{groups[id].map(row)}</div>
              </section>
            )) : (
              <div className="work-my-empty">
                {filter === "all"
                  ? <><CheckCircle2 size={18} aria-hidden="true" /> Chưa có việc nào đang giao cho bạn. Việc được giao trong họp hay giao miệng thì bấm <b>Ghi việc được giao</b>.</>
                  : <>Không có việc trong nhóm này. <button className="work-text-button" onClick={() => setFilter("all")}>Xem tất cả</button></>}
              </div>
            )}
            {groups.done.length > 0 && filter === "all" && (
              <section className="work-my-group" aria-label="Đã xong tuần này">
                <h2 className="work-my-group-h">Đã xong tuần này <span className="work-count">{groups.done.length}</span>
                  <button type="button" className="work-text-button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>{showDone ? "Ẩn" : "Xem"}</button></h2>
                {showDone && <div className="work-my-list">{groups.done.map(row)}</div>}
              </section>
            )}
          </div>
          <aside className="work-my-side">
            <section className="work-my-card" aria-label={`Tuần ${myWeekLabel(data)}`}>
              <header><h2><CalendarDays size={15} aria-hidden="true" /> {myWeekLabel(data).split(" · ")[0]}</h2><span>Chốt thứ 7 {ddmm(saturdayOf(data.weekStart))}</span></header>
              <div className="work-my-week">{myWeekDays(data.weekStart, data.tasks).map((d) => (
                <div key={d.day} className={`work-my-day${d.day === data.today ? " is-today" : ""}`}>
                  <span>{d.label}</span><b>{d.date}</b>
                  <span className="work-my-dots">{d.tasks.slice(0, 6).map((t) => (
                    <i key={t.id} className={`level-${t.level}${t.status === "completed" ? " is-done" : ""}`} title={`${t.level} · ${t.title}`} />
                  ))}</span>
                </div>
              ))}</div>
              <p className="work-my-legend">{(["A", "B", "C"] as const).map((l) => <span key={l}><span className={`work-level-chip level-${l}`}>{l}</span> {WORK_LEVEL_LABELS[l]}</span>)}</p>
            </section>
            {stats}
          </aside>
        </div>
      )}
    </section>
  );
}

/** Dòng việc gọn (chủ SP 20/10: ít chữ, cần thì bấm xem chi tiết): nguồn chỉ còn biểu tượng (chữ khi rê chuột), trừ Chỉ đạo / Giao miệng;
 *  không hiện thẻ; "cập nhật …" chỉ khi đã quá 48 giờ. */
function TaskRow({ t, unitName, to, edit, setEdit, busy, error, act }: {
  t: WorkMyTask; unitName: string | null; to: string; edit: Edit; setEdit: (e: Edit) => void; busy: boolean; error: string | null;
  act: (t: WorkMyTask, kind: "doing" | "blocked" | "done", text?: string) => Promise<void>;
}) {
  const due = workDueInfo(t.deadlineAt, t.status);
  const upd = workUpdateInfo(t.lastProgressAt, t.status);
  const src = mySource(t, unitName);
  const SrcIcon = src.kind === "directive" ? MessageSquare : src.kind === "oral" ? PenLine : src.kind === "self" ? User : src.kind === "head" ? UserCheck : UserRound;
  const srcShort = src.kind === "directive" ? "Chỉ đạo" : src.kind === "oral" ? "Giao miệng" : null;
  const editing = edit?.id === t.id ? edit : null;
  const claim = t.origin?.origin === "oral_claim" && t.origin.claimStatus === "pending";
  const done = t.status === "completed";
  const canDoing = t.can.acknowledge || t.can.start || t.can.unblock;
  const canBlock = t.can.acknowledge || t.can.start || t.can.block;
  const canDone = t.can.acknowledge || t.can.start || t.can.submit || t.can.unblock;
  let action: React.ReactNode;
  if (claim) action = <span className="work-pill tone-amber"><Clock3 size={13} /> Chờ {t.origin?.giver?.name || "người giao"} xác nhận</span>;
  else if (t.status === "awaiting_review") action = <span className="work-pill tone-amber">Chờ duyệt</span>;
  else if (done) action = <span className="work-pill tone-ok"><Check size={13} /> Xong</span>;
  else action = (
    <div className="work-quick-seg work-my-seg" role="group" aria-label={`Cập nhật trạng thái ${t.code}`}>
      <button type="button" aria-pressed={t.status === "in_progress"} disabled={busy || (!canDoing && t.status !== "in_progress")}
        onClick={() => t.status !== "in_progress" && void act(t, "doing")}
        title={t.can.acknowledge ? "Nhận việc và bắt đầu làm" : undefined}>Đang làm</button>
      <button type="button" data-v="blocked" aria-pressed={t.status === "blocked"} disabled={busy || (!canBlock && t.status !== "blocked")}
        onClick={() => t.status !== "blocked" && setEdit(editing?.kind === "blocked" ? null : { id: t.id, kind: "blocked", text: "" })}>Vướng</button>
      <button type="button" aria-pressed={false} disabled={busy || !canDone}
        onClick={() => setEdit(editing?.kind === "done" ? null : { id: t.id, kind: "done", text: "" })}>Xong</button>
    </div>
  );
  const meta: React.ReactNode[] = [
    <span key="due" className={`work-due tone-${due.tone}`}><Clock3 size={13} aria-hidden="true" /> {done && t.completedAt ? `Xong ${workDayLabel(t.completedAt)}` : due.text}</span>,
  ];
  if (!claim) meta.push(<span key="p" className="work-row-progress"><span><i style={{ width: `${t.progressPercent}%` }} /></span><b>{t.progressPercent}%</b></span>);
  if (upd?.stale) meta.push(<span key="u" className="work-stale">{upd.text}</span>);
  if (t.checklist.total) meta.push(<span key="c" className="work-num" title={`Checklist ${t.checklist.done}/${t.checklist.total}`}><ListChecks size={13} aria-hidden="true" /> {t.checklist.done}/{t.checklist.total}</span>);
  if (!t.acknowledged && !done) meta.push(<span key="a" className="work-pill tone-amber">Chưa nhận việc</span>);
  if (t.status === "blocked" && t.blockedReason) meta.push(<span key="b" className="work-my-blocked"><AlertTriangle size={13} aria-hidden="true" /> {t.blockedReason}</span>);
  return (
    <article className={`work-my-task work-level-row level-${t.level}${done ? " is-done" : ""}`}>
      <div className="work-my-task-main">
        <div className="work-my-task-top">
          <span className={`work-level-chip level-${t.level}`} title={WORK_LEVEL_LABELS[t.level]}>{t.level}</span>
          <span className={`work-src is-${src.kind}`} title={src.text} aria-label={src.text}><SrcIcon size={13} aria-hidden="true" />{srcShort && ` ${srcShort}`}</span>
          <h3 className="work-my-task-title"><Link to={to}>{t.title}</Link></h3>
        </div>
        <div className="work-my-task-meta">{meta}</div>
        {editing && (
          <form className="work-my-edit" onSubmit={(e) => { e.preventDefault(); if (editing.text.trim().length >= 3) void act(t, editing.kind, editing.text); }}>
            <input className="work-input" autoFocus maxLength={editing.kind === "blocked" ? 500 : 2000} value={editing.text} aria-label={editing.kind === "blocked" ? "Vướng gì" : "Kết quả"}
              placeholder={editing.kind === "blocked" ? "Vướng gì? Một dòng" : t.needsReview ? "Kết quả nộp người giao duyệt · một dòng" : "Kết quả · một dòng"}
              onChange={(e) => setEdit({ ...editing, text: e.target.value })} />
            <button className="work-primary" disabled={busy || editing.text.trim().length < 3}
              title={editing.text.trim().length < 3 ? "Ghi ít nhất 3 ký tự" : undefined}>
              {busy ? <Loader2 size={15} className="work-spin" /> : null}
              {editing.kind === "blocked" ? "Báo vướng" : t.needsReview ? "Nộp duyệt" : "Hoàn thành"}
            </button>
            <button type="button" className="work-secondary" onClick={() => setEdit(null)}>Hủy</button>
            {editing.kind === "done" && <Link className="work-text-button" to={to}>Nộp kèm tệp ở chi tiết</Link>}
          </form>
        )}
        {error && <p className="work-error" role="alert">{error}</p>}
      </div>
      <div className="work-my-task-act">{action}</div>
    </article>
  );
}

/** Ghi việc được giao trực tiếp (trong họp, gọi điện, nói miệng): tự giao cho mình rồi gửi người giao xác nhận một chạm. */
function WorkClaimComposer({ board, service, me, weekStart, onCancel, onDone }: {
  board: Pick<WorkBoardService, "assignablePeople" | "setOrigin">;
  service: Pick<WorkTaskService, "preview" | "create">;
  me: string; weekStart: string;
  onCancel: () => void; onDone: (message: string) => void;
}) {
  const [people, setPeople] = useState<WorkAssignablePerson[] | null>(null);
  const [title, setTitle] = useState("");
  const [giverId, setGiverId] = useState("");
  const [date, setDate] = useState(saturdayOf(weekStart));
  const [level, setLevel] = useState<WorkLevel>("B");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<{ signature: string; value: WorkCreateAttempt; taskId?: string } | null>(null);
  useEffect(() => {
    let live = true;
    board.assignablePeople(null, 200).then((r) => { if (live) setPeople(r.people.filter((p) => !p.isMe).sort((a, b) => a.name.localeCompare(b.name, "vi"))); },
      () => { if (live) setError("Không tải được danh sách người giao."); });
    return () => { live = false; };
  }, [board]);
  const giver = people?.find((p) => p.userId === giverId) || null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const deadline = dateAt(date, "17:00");
    if (title.trim().length < 2) { setError("Nhập việc được giao."); return; }
    if (!giver) { setError("Chọn người giao việc."); return; }
    if (!deadline || deadline.getTime() <= Date.now()) { setError("Chọn hạn sau thời điểm hiện tại."); return; }
    const input = quickTaskInput({ title, assigneeId: me, deadline, level, description: "", checklist: "", tags: "", evidence: { photo: false, file: false } });
    const signature = JSON.stringify(input) + giver.userId;
    setBusy(true); setError("");
    try {
      let current = attempt && attempt.signature === signature ? attempt : null;
      if (!current) {
        const preview = await service.preview(input.recipientSources, input.scope);
        current = { signature, value: new WorkCreateAttempt(input, preview.fingerprint) };
      }
      if (!current.taskId) {
        const created = await service.create(current.value.input, current.value.key, current.value.fingerprint);
        current = { ...current, taskId: created.taskId };
      }
      setAttempt(current);
      await board.setOrigin(current.taskId!, "oral_claim", null, giver.userId);
      onDone(`Đã ghi việc “${title.trim()}” · chờ ${giver.name} xác nhận`);
    } catch (caught) {
      setError(workError(caught));
    } finally { setBusy(false); }
  }
  return (
    <form className="work-my-claim" onSubmit={submit} aria-label="Ghi việc được giao" noValidate>
      <label className="work-label">Việc được giao
        <input className="work-input" autoFocus value={title} maxLength={300} placeholder="VD: Gửi báo giá cẩu 50 tấn cho PTGĐ" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="work-label">Người giao
        <select className="work-input" value={giverId} disabled={!people} onChange={(e) => setGiverId(e.target.value)}>
          <option value="" disabled>{people ? "Chọn người giao" : "Đang tải…"}</option>
          {(people || []).map((p) => <option key={p.userId} value={p.userId}>{p.name}{p.unit?.code ? ` · ${p.unit.code}` : ""}</option>)}
        </select>
      </label>
      <label className="work-label">Hạn
        <input className="work-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="work-label">Mức
        <div className="work-quick-seg work-quick-level" role="group" aria-label="Mức quan trọng">
          {(["A", "B", "C"] as const).map((l) => <button type="button" key={l} data-level={l} aria-pressed={level === l} title={WORK_LEVEL_LABELS[l]} onClick={() => setLevel(l)}>{l}</button>)}
        </div>
      </div>
      <div className="work-my-claim-foot">
        {error && <p className="work-error" role="alert">{error}</p>}
        <span className="work-hint">Việc vào danh sách của bạn ngay; người giao bấm xác nhận thì mới tính vào chỉ số.</span>
        <button type="button" className="work-secondary" onClick={onCancel} disabled={busy}>Hủy</button>
        <button className="work-primary" disabled={busy}>{busy ? <Loader2 size={15} className="work-spin" /> : <Check size={16} />} Gửi người giao xác nhận</button>
      </div>
    </form>
  );
}

