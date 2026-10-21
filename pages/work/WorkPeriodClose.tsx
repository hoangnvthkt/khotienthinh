import React, { useEffect, useState } from "react";
import { CalendarClock, Check, History, Loader2, Lock, LockOpen, Presentation, Settings2, Sparkles } from "lucide-react";
import type { WorkBoardService, WorkCompanyBoard, WorkTeamBoard } from "../../lib/work/workBoardService";
import { ontimeRate } from "../../lib/work/workBoardService";
import { companyTotals, teamTotals } from "../../lib/work/workBoards";
import { workError } from "../../lib/work/workForm";
import { workDayLabel } from "../../lib/work/workPresentation";
import type { WorkAiService } from "../../lib/work/workAi";
import { localIsoDate } from "../../lib/work/workAiText";
import {
  CADENCE_LABELS, DOW_LABELS, DOW_SHORT, GOAL_STATUS, achievedOf, closeDueLabel, closeDueOf, formatGoalValue, goalStatusOf, parseGoalNumber,
  periodReviewFacts, reviewKey, settingLabel, type WorkCadence, type WorkGoal, type WorkGoalService, type WorkPeriodCloseDetail, type WorkPeriodSetting,
  type WorkPeriodSettings, type WorkPeriodStatus,
} from "../../lib/work/workGoals";
import type { WorkPeriod, WorkPeriodQuery } from "../../lib/work/workPeriod";
import { daysBetween } from "../../lib/work/workPeriod";
import { MemberTable, MiniStats, rateText, type DrawerView } from "./WorkBoardsUi";
import { GoalBar, GoalPill } from "./WorkGoals";

/** "21/10 09:56" (giờ máy người xem). */
const when = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
/** Kỳ đang xem có khớp chu kỳ chốt không (để nhắc hạn chốt đúng chỗ). */
const fitsCadence = (cadence: WorkCadence, p: WorkPeriod) =>
  (cadence === "week" && (p.preset === "week" || p.preset === "last_week")) || (cadence === "month" && p.preset === "month")
  || (cadence === "2weeks" && daysBetween(p.from, p.to) === 13);

export interface PeriodScope {
  orgUnitId: string | null; scopeName: string; period: WorkPeriod; query: WorkPeriodQuery; label: string;
}

/** Dải trạng thái kỳ dưới đầu màn: đang mở (hạn chốt + Chốt kỳ) / đã chốt (ai, khi nào + Xem bản chốt + Mở lại). */
export function WorkPeriodBar({ goalsService, scope, reloadKey, onCloseClick, onOpen, onSettings, onReport }: {
  goalsService: WorkGoalService; scope: PeriodScope; reloadKey: unknown;
  onCloseClick: (status: WorkPeriodStatus) => void; onOpen: (closeId: string, canClose: boolean) => void; onSettings: () => void;
  /** PR-7: mở báo cáo kỳ (trình chiếu / PDF). */
  onReport?: () => void;
}) {
  const [status, setStatus] = useState<WorkPeriodStatus | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setStatus(null); setError(false);
    goalsService.status(scope.orgUnitId, scope.period.from, scope.period.to).then((s) => { if (live) setStatus(s); }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [goalsService, scope.orgUnitId, scope.period.from, scope.period.to, reloadKey]);
  if (error) return null;
  if (!status) return <div className="work-pbar is-loading" aria-busy="true"><Loader2 size={14} className="work-spin" /> Đang kiểm kỳ…</div>;
  const reopens = status.history.filter((h) => h.action === "reopen").length;
  const today = localIsoDate(new Date());
  const due = fitsCadence(status.setting.cadence, scope.period) ? closeDueOf(status.setting, scope.period.from, scope.period.to) : null;
  const late = due && `${due.day} ${due.time}` < `${today} ${new Date().toTimeString().slice(0, 5)}`;
  if (status.close) {
    return (
      <div className="work-pbar is-closed">
        <Lock size={16} aria-hidden="true" />
        <span><b>Đã chốt</b> {when(status.close.closedAt)} · {status.close.closedBy}</span>
        {reopens > 0 && <span className="work-pill tone-amber" title="Số lần mở lại kỳ này">Mở lại {reopens} lần</span>}
        <span className="work-pbar-acts">
          {onReport && <button type="button" className="work-primary work-sm" onClick={onReport}><Presentation size={14} /> Báo cáo</button>}
          <button type="button" className="work-secondary work-sm" onClick={() => onOpen(status.close!.id, status.canClose)}>Xem bản chốt</button>
          <button type="button" className="work-icon-button" aria-label="Lịch chốt" title="Lịch chốt" onClick={onSettings}><Settings2 size={16} /></button>
        </span>
      </div>
    );
  }
  return (
    <div className={`work-pbar${late ? " is-due" : ""}`}>
      <CalendarClock size={16} aria-hidden="true" />
      <span><b>Kỳ đang mở</b>{due && <> · hạn chốt {closeDueLabel(due)}</>}</span>
      {reopens > 0 && <span className="work-pill tone-amber">Đã mở lại {reopens} lần</span>}
      <span className="work-pbar-acts">
        {onReport && <button type="button" className="work-secondary work-sm" onClick={onReport} title="Số tạm tính — chốt kỳ để cố định"><Presentation size={14} /> Báo cáo</button>}
        {status.canClose && scope.period.from <= today && (
          <button type="button" className={late ? "work-primary work-sm" : "work-secondary work-sm"} onClick={() => onCloseClick(status)}><Lock size={14} /> Chốt kỳ</button>
        )}
        <button type="button" className="work-icon-button" aria-label="Lịch chốt" title={`Lịch chốt: ${settingLabel(status.setting)}`} onClick={onSettings}><Settings2 size={16} /></button>
      </span>
    </div>
  );
}

// ── Chốt kỳ ────────────────────────────────────────────────────────────────────────────────────────
export interface CloseFacts { due: number; ontime: number; overdue: number; stale?: number; prevRate: number | null;
  directives?: { open: number; late: number; done: number } | null }

export function closeView(props: {
  goalsService: WorkGoalService; board: Pick<WorkBoardService, "tasksOverview">; ai: WorkAiService | null; scope: PeriodScope; unitCode: string | null;
  facts: CloseFacts; onClosed: (message: string) => void;
}): DrawerView {
  return { key: "close", title: `Chốt ${props.scope.label}`, sub: props.scope.scopeName, body: <ClosePanel {...props} /> };
}

type Review = { actual: string; assessment: string; solution: string };

function ClosePanel({ goalsService, board, ai, scope, unitCode, facts, onClosed }: Parameters<typeof closeView>[0]) {
  const [goals, setGoals] = useState<WorkGoal[] | null>(null);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [note, setNote] = useState("");
  const [aiState, setAiState] = useState<{ busy: boolean; runId: string | null; error: string }>({ busy: false, runId: null, error: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = localIsoDate(new Date());

  useEffect(() => {
    let live = true;
    goalsService.goals(scope.orgUnitId, scope.query.from, scope.query.to).then((d) => {
      if (!live) return;
      setGoals(d.goals);
      setReviews(Object.fromEntries(d.goals.map((g) => [g.id, {
        actual: g.actualValue != null ? String(g.actualValue).replace(".", ",") : "", assessment: g.assessment || "", solution: g.solution || "" }])));
    }, (e) => { if (live) { setGoals([]); setError(workError(e)); } });
    return () => { live = false; };
  }, [goalsService, scope.orgUnitId, scope.query.from, scope.query.to]);

  const set = (id: string, patch: Partial<Review>) => setReviews((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const actualOf = (g: WorkGoal) => parseGoalNumber(reviews[g.id]?.actual ?? "");
  const statusOf = (g: WorkGoal) => { const a = actualOf(g); return goalStatusOf(g, Number.isNaN(a) ? null : a, today); };
  const missing = (goals || []).filter((g) => statusOf(g) === "missed" && !(reviews[g.id]?.solution || "").trim());
  const badNumber = (goals || []).some((g) => Number.isNaN(actualOf(g)));
  const rate = ontimeRate(facts.ontime, facts.due);

  const draft = async () => {
    if (!ai || !goals) return;
    setAiState({ busy: true, runId: null, error: "" });
    const late = unitCode !== undefined ? await board.tasksOverview({ unit: unitCode, state: "overdue", limit: 12 }).then((r) => r.items || [], () => []) : [];
    const current = goals.map((g) => { const a = actualOf(g); const actual = Number.isNaN(a) ? null : a;
      return { ...g, actualValue: actual, achievedPercent: achievedOf(g.targetValue, actual, g.higherIsBetter), status: statusOf(g) }; });
    const text = periodReviewFacts({ scopeName: scope.scopeName, label: scope.label, board: facts, directives: facts.directives, goals: current,
      lateTasks: late.map((t) => ({ title: t.title, people: t.assignees.map((a) => a.name).join(", "), deadline: t.deadlineAt ? workDayLabel(t.deadlineAt) : null })) });
    const r = await ai.periodReview(text, goals.map((g, i) => ({ id: reviewKey(i), title: g.title })));
    if (!r.ok) { setAiState({ busy: false, runId: null, error: r.message }); return; }
    // Chỉ nhận khóa đã gửi (M1, M2…) rồi đổi về id mục tiêu.
    const byKey = new Map(goals.map((g, i) => [reviewKey(i), g.id]));
    setReviews((prev) => {
      const next = { ...prev };
      for (const x of r.result.goals || []) {
        const id = byKey.get(x.id);
        if (id) next[id] = { ...next[id], assessment: x.assessment || next[id].assessment, solution: x.solution || next[id].solution };
      }
      return next;
    });
    setNote([r.result.overall?.assessment, r.result.overall?.solution].filter(Boolean).join("\n"));
    setAiState({ busy: false, runId: r.runId, error: "" });
  };

  const submit = async () => {
    if (!goals || missing.length || badNumber) return;
    setBusy(true); setError("");
    try {
      // Lưu theo trọn kỳ (chốt tuần vào thứ 7 vẫn là T2–CN); máy chủ chỉ tính số đến hôm nay.
      await goalsService.close({ orgUnitId: scope.orgUnitId, from: scope.period.from, to: scope.period.to, prevFrom: scope.query.prevFrom, prevTo: scope.query.prevTo,
        label: scope.label, note: note.trim() || null, aiRunId: aiState.runId,
        reviews: goals.map((g) => ({ goalId: g.id, actualValue: actualOf(g), assessment: reviews[g.id]?.assessment.trim() || null, solution: reviews[g.id]?.solution.trim() || null })) });
      onClosed(`Đã chốt ${scope.label}`);
    } catch (e) { setError(workError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="work-close">
      <MiniStats items={[["Đúng hạn", <>{rateText(rate)}{facts.due > 0 && <small> {facts.ontime}/{facts.due}</small>}</>],
        ["Quá hạn", facts.overdue, facts.overdue ? "rose" : undefined],
        ...(facts.directives ? [["Chỉ đạo xong", <>{facts.directives.done}<small>/{facts.directives.done + facts.directives.open}</small></>] as [string, React.ReactNode]] : []),
        ["Mục tiêu", goals ? goals.length : "…"]]} />
      {ai && goals && (
        <div className="work-close-ai">
          <button type="button" className="work-secondary" disabled={aiState.busy} onClick={() => void draft()}>
            {aiState.busy ? <Loader2 size={15} className="work-spin" /> : <Sparkles size={15} />} {aiState.runId ? "AI soạn lại" : "AI soạn nháp đánh giá"}</button>
          {aiState.runId && <span className="work-hint">Nháp AI — xem, sửa rồi chốt.</span>}
          {aiState.error && <span className="work-error" role="alert">{aiState.error}</span>}
        </div>
      )}
      {!goals ? <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải mục tiêu…</p> : goals.map((g) => {
        const st = statusOf(g); const r = reviews[g.id] || { actual: "", assessment: "", solution: "" };
        const a = actualOf(g); const pct = achievedOf(g.targetValue, Number.isNaN(a) ? null : a, g.higherIsBetter);
        const need = st === "missed";
        return (
          <article key={g.id} className={`work-close-goal tone-${GOAL_STATUS[st].tone}`}>
            <header><b>{g.title}</b><small>{g.label}</small><span className={`work-pill tone-${GOAL_STATUS[st].tone}`}>{GOAL_STATUS[st].label}</span></header>
            <div className="work-close-row">
              {g.targetValue != null && (
                <label className="work-label">Thực tế <small>chỉ tiêu {formatGoalValue(g.targetValue, g.measure)}</small>
                  <span className="work-close-num">
                    <input className="work-input" inputMode="decimal" value={r.actual} aria-invalid={Number.isNaN(a)} onChange={(e) => set(g.id, { actual: e.target.value })} />
                    <b className="work-num">{pct == null ? "—" : `${pct}%`}</b>
                  </span>
                </label>
              )}
              <span className="work-close-tasks">{g.tasks.done}/{g.tasks.total} việc xong · {g.tasks.ontime} đúng hạn{g.tasks.overdue ? ` · ${g.tasks.overdue} quá hạn` : ""}</span>
            </div>
            <label className="work-label">Đánh giá
              <textarea className="work-input" rows={2} maxLength={3000} value={r.assessment} onChange={(e) => set(g.id, { assessment: e.target.value })} />
            </label>
            <label className="work-label">Giải pháp {need ? <small className="work-req">bắt buộc khi chưa đạt</small> : <small>không bắt buộc</small>}
              <textarea className="work-input" rows={2} maxLength={3000} value={r.solution} aria-invalid={need && !r.solution.trim()}
                placeholder={need ? "Ai làm gì, đến khi nào" : ""} onChange={(e) => set(g.id, { solution: e.target.value })} />
            </label>
          </article>
        );
      })}
      <label className="work-label">Nhận xét kỳ <small>không bắt buộc</small>
        <textarea className="work-input" rows={3} maxLength={3000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {missing.length > 0 && <p className="work-error" role="alert">Còn {missing.length} mục tiêu chưa đạt cần ghi Giải pháp.</p>}
      {badNumber && <p className="work-error" role="alert">Số thực tế phải là số, VD 5 hoặc 1.250,5.</p>}
      {error && <p className="work-error" role="alert">{error}</p>}
      <div className="work-goal-foot">
        <button type="button" className="work-primary" disabled={busy || !goals || missing.length > 0 || badNumber} onClick={() => void submit()}
          title="Số liệu kỳ được lưu cố định; muốn sửa phải mở lại kèm lý do">
          {busy ? <Loader2 size={15} className="work-spin" /> : <Lock size={15} />} Chốt kỳ</button>
      </div>
    </div>
  );
}

// ── Bản chốt ───────────────────────────────────────────────────────────────────────────────────────
export function snapshotView(props: { goalsService: WorkGoalService; closeId: string; canReopen: boolean; onReopened: (message: string) => void }): DrawerView {
  return { key: `snap-${props.closeId}`, title: "Bản chốt", body: <Snapshot {...props} /> };
}

const isTeam = (b: WorkTeamBoard | WorkCompanyBoard): b is WorkTeamBoard => Array.isArray((b as WorkTeamBoard).members);

function Snapshot({ goalsService, closeId, canReopen, onReopened }: Parameters<typeof snapshotView>[0]) {
  const [d, setD] = useState<WorkPeriodCloseDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rError, setRError] = useState("");
  useEffect(() => {
    let live = true;
    goalsService.closeDetail(closeId).then((x) => { if (live) setD(x); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [goalsService, closeId]);
  if (error) return <p className="work-error" role="alert">{workError(error)}</p>;
  if (!d) return <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải bản chốt…</p>;
  const s = d.snapshot; const b = s.board;
  const tot = isTeam(b) ? teamTotals(b.members) : companyTotals(b.units);
  const reopen = async () => {
    setBusy(true); setRError("");
    try { await goalsService.reopen(d.id, reason || ""); onReopened(`Đã mở lại ${d.label}`); } catch (e) { setRError(workError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="work-snap">
      <div className="work-snap-head">
        <b>{d.label}</b>
        <span>{s.scope.name || "Toàn công ty"} · chốt {when(d.closedAt)} · {d.closedBy}</span>
        {d.status === "reopened" && <span className="work-pill tone-amber">Đã mở lại</span>}
      </div>
      <MiniStats items={[["Đúng hạn", <>{rateText(tot.rate)}{tot.due > 0 && <small> {tot.ontime}/{tot.due}</small>}</>],
        ["Kỳ trước", rateText(tot.prevRate)], ["Quá hạn", tot.overdue, tot.overdue ? "rose" : undefined],
        ["Mục tiêu đạt", <>{s.goals.filter((g) => g.status === "met").length}<small>/{s.goals.length}</small></>]]} />
      {d.note && <p className="work-goal-text">{d.note}</p>}
      {s.goals.length > 0 && <>
        <h3 className="work-my-group-h">Mục tiêu</h3>
        {s.goals.map((g) => (
          <article key={g.id} className="work-snap-goal">
            <header><b>{g.title}</b><small>{g.label}</small><GoalPill g={g} /></header>
            <div className="work-snap-val"><GoalBar g={g} /><b className="work-num">{g.achievedPercent == null ? "—" : `${g.achievedPercent}%`}</b>
              <small>{formatGoalValue(g.actualValue, null)} / {formatGoalValue(g.targetValue, g.measure)} · {g.tasks.done}/{g.tasks.total} việc</small></div>
            {g.assessment && <p><em>Đánh giá:</em> {g.assessment}</p>}
            {g.solution && <p><em>Giải pháp:</em> {g.solution}</p>}
          </article>
        ))}
      </>}
      <h3 className="work-my-group-h">{isTeam(b) ? "Nhân viên" : "Đơn vị"}</h3>
      {isTeam(b) ? <MemberTable members={b.members} /> : (
        <div className="work-snap-units">{b.units.map((u) => { const r = ontimeRate(u.ontime, u.due); return (
          <div key={u.id}><b>{u.name}</b><span className="work-num">{rateText(r)}</span><small className="work-num">{u.due ? `${u.ontime}/${u.due}` : "—"}</small>
            {u.overdue > 0 ? <span className="work-pill tone-rose">{u.overdue} quá hạn</span> : <span />}</div>); })}</div>
      )}
      {d.history.length > 1 && <>
        <h3 className="work-my-group-h"><History size={14} aria-hidden="true" /> Lịch sử</h3>
        <ul className="work-snap-hist">{d.history.map((h, i) => (
          <li key={i}><b>{h.action === "reopen" ? "Mở lại" : "Chốt"}</b> {when(h.at)} · {h.actor}{h.reason ? <> — “{h.reason}”</> : null}</li>
        ))}</ul>
      </>}
      {canReopen && d.status === "closed" && (reason === null
        ? <div className="work-goal-foot"><button type="button" className="work-secondary" onClick={() => setReason("")}><LockOpen size={15} /> Mở lại kỳ</button></div>
        : <form className="work-dir-a" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 5) void reopen(); }}>
            <input className="work-input" autoFocus maxLength={500} aria-label="Lý do mở lại" placeholder="Lý do mở lại (BLĐ sẽ thấy)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="work-primary" disabled={busy || reason.trim().length < 5}>{busy && <Loader2 size={14} className="work-spin" />} Mở lại</button>
            <button type="button" className="work-secondary" onClick={() => setReason(null)}>Hủy</button>
          </form>)}
      {rError && <p className="work-error" role="alert">{rError}</p>}
    </div>
  );
}

// ── Lịch chốt ──────────────────────────────────────────────────────────────────────────────────────
export function settingsView(props: { goalsService: WorkGoalService; onSaved: (message: string) => void }): DrawerView {
  return { key: "period-settings", title: "Lịch chốt kỳ", body: <PeriodSettings {...props} /> };
}

function PeriodSettings({ goalsService, onSaved }: Parameters<typeof settingsView>[0]) {
  const [data, setData] = useState<WorkPeriodSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<string | null>(null); // "company" | unitId
  useEffect(() => {
    let live = true;
    goalsService.settings().then((x) => { if (live) setData(x); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [goalsService, tick]);
  if (error) return <p className="work-error" role="alert">{workError(error)}</p>;
  if (!data) return <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải…</p>;
  const done = (m: string) => { setEdit(null); setTick((v) => v + 1); onSaved(m); };
  const own = (unitId: string) => data.overrides.find((o) => o.orgUnitId === unitId) || null;
  return (
    <div className="work-psettings">
      <section className="work-ps-row">
        <div><b>Toàn công ty</b><span>{settingLabel(data.company)} · báo cáo {DOW_SHORT[data.company.reportDow]} {data.company.reportTime}</span></div>
        {data.canEditCompany && edit !== "company" && <button type="button" className="work-secondary work-sm" onClick={() => setEdit("company")}>Sửa</button>}
      </section>
      {edit === "company" && <SettingForm goalsService={goalsService} orgUnitId={null} initial={data.company} onCancel={() => setEdit(null)} onDone={done} />}
      {data.editableUnits.length > 0 && <h3 className="work-my-group-h">Đơn vị</h3>}
      {data.editableUnits.map((u) => {
        const o = own(u.id);
        return (
          <React.Fragment key={u.id}>
            <section className="work-ps-row">
              <div><b>{u.name}</b><span>{o ? `${settingLabel(o)} · báo cáo ${DOW_SHORT[o.reportDow]} ${o.reportTime}` : "Theo lịch công ty"}</span></div>
              {edit !== u.id && <span className="work-ps-acts">
                <button type="button" className="work-secondary work-sm" onClick={() => setEdit(u.id)}>{o ? "Sửa" : "Đặt riêng"}</button>
                {o && <ResetButton goalsService={goalsService} unitId={u.id} onDone={() => done(`${u.name} theo lịch công ty`)} />}
              </span>}
            </section>
            {edit === u.id && <SettingForm goalsService={goalsService} orgUnitId={u.id} initial={o || data.company} onCancel={() => setEdit(null)} onDone={done} />}
          </React.Fragment>
        );
      })}
      {data.reopens.length > 0 && <>
        <h3 className="work-my-group-h"><History size={14} aria-hidden="true" /> Mở lại gần đây</h3>
        <ul className="work-snap-hist">{data.reopens.map((r) => (
          <li key={`${r.closeId}-${r.at}`}><b>{r.unit?.name || "Toàn công ty"}</b> · {r.label} · {when(r.at)} · {r.actor}{r.reason ? <> — “{r.reason}”</> : null}</li>
        ))}</ul>
      </>}
    </div>
  );
}

function ResetButton({ goalsService, unitId, onDone }: { goalsService: WorkGoalService; unitId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className="work-text-button" disabled={busy} onClick={async () => {
    setBusy(true); try { await goalsService.resetSetting(unitId); onDone(); } finally { setBusy(false); } }}>Theo công ty</button>;
}

function SettingForm({ goalsService, orgUnitId, initial, onCancel, onDone }: {
  goalsService: WorkGoalService; orgUnitId: string | null; initial: WorkPeriodSetting; onCancel: () => void; onDone: (message: string) => void;
}) {
  const [s, setS] = useState({ cadence: initial.cadence, closeDow: initial.closeDow, closeTime: initial.closeTime, reportDow: initial.reportDow, reportTime: initial.reportTime });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await goalsService.saveSetting(orgUnitId, s); onDone("Đã lưu lịch chốt"); } catch (err) { setError(workError(err)); } finally { setBusy(false); }
  };
  const dow = (value: number, on: (v: number) => void, label: string) => (
    <select className="work-input work-select" aria-label={label} value={value} onChange={(e) => on(Number(e.target.value))}>
      {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DOW_LABELS[d]}</option>)}
    </select>
  );
  return (
    <form className="work-ps-form" onSubmit={save}>
      <div className="work-quick-seg" role="group" aria-label="Chu kỳ chốt">
        {(Object.keys(CADENCE_LABELS) as WorkCadence[]).map((c) => <button type="button" key={c} aria-pressed={s.cadence === c} onClick={() => setS({ ...s, cadence: c })}>{CADENCE_LABELS[c]}</button>)}
      </div>
      <div className="work-ps-line"><span>Chốt</span>{dow(s.closeDow, (v) => setS({ ...s, closeDow: v }), "Thứ chốt")}
        <input className="work-input" type="time" aria-label="Giờ chốt" value={s.closeTime} onChange={(e) => setS({ ...s, closeTime: e.target.value })} /></div>
      <div className="work-ps-line"><span>Báo cáo</span>{dow(s.reportDow, (v) => setS({ ...s, reportDow: v }), "Thứ báo cáo")}
        <input className="work-input" type="time" aria-label="Giờ báo cáo" value={s.reportTime} onChange={(e) => setS({ ...s, reportTime: e.target.value })} /></div>
      {error && <p className="work-error" role="alert">{error}</p>}
      <div className="work-goal-foot">
        <button className="work-primary" disabled={busy || !s.closeTime || !s.reportTime}>{busy ? <Loader2 size={15} className="work-spin" /> : <Check size={15} />} Lưu</button>
        <button type="button" className="work-text-button" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  );
}
