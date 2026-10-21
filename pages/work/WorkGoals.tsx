import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarRange, Check, Clock3, Loader2, Plus, Split, Target, Trash2, X } from "lucide-react";
import type { WorkAssignablePerson, WorkBoardService, WorkOverviewTask } from "../../lib/work/workBoardService";
import { WORK_LEVEL_LABELS } from "../../lib/work/workBoardService";
import { workError } from "../../lib/work/workForm";
import { workDayLabel, workDueInfo } from "../../lib/work/workPresentation";
import {
  GOAL_STATUS, formatGoalValue, goalCounts, goalPeriodLabel, goalPeriodOptions, goalTree, parseGoalNumber,
  type WorkGoal, type WorkGoalInput, type WorkGoalService, type WorkGoalTask,
} from "../../lib/work/workGoals";
import type { DrawerView } from "./WorkBoardsUi";

export type GoalBoard = Pick<WorkBoardService, "tasksOverview" | "assignablePeople">;
const MEASURES = ["%", "việc", "tỷ", "triệu", "hồ sơ", "tấn", "m³", "ngày"];

/** Thanh % đạt: xanh khi đạt, cam khi rủi ro, đỏ khi chưa đạt; không có số thì thanh rỗng + "—". */
export function GoalBar({ g }: { g: Pick<WorkGoal, "achievedPercent" | "status"> }) {
  return (
    <span className="work-goal-bar" aria-hidden="true">
      <i className={`tone-${GOAL_STATUS[g.status].tone}`} style={{ width: `${Math.min(100, g.achievedPercent ?? 0)}%` }} />
    </span>
  );
}
export const GoalPill = ({ g }: { g: Pick<WorkGoal, "status"> }) => <span className={`work-pill tone-${GOAL_STATUS[g.status].tone}`}>{GOAL_STATUS[g.status].label}</span>;
const valueLine = (g: WorkGoal) => g.targetValue == null ? null
  : `${formatGoalValue(g.actualValue, null)} / ${formatGoalValue(g.targetValue, g.measure)}`;

/** Một dòng mục tiêu (quý có tháng con thụt vào). */
function GoalRow({ g, child, onOpen }: { g: WorkGoal; child?: boolean; onOpen: (g: WorkGoal) => void }) {
  return (
    <button type="button" className={`work-goal-r${child ? " is-child" : ""}`} onClick={() => onOpen(g)}>
      <span className="work-goal-name"><b>{g.title}</b><small>{g.label}{g.owner ? ` · ${g.owner.name}` : ""}</small></span>
      <span className="work-goal-val" data-label="Chỉ tiêu">
        <GoalBar g={g} />
        <b className="work-num">{g.achievedPercent == null ? "—" : `${g.achievedPercent}%`}</b>
        {valueLine(g) && <small className="work-num">{valueLine(g)}</small>}
      </span>
      <span className="work-goal-tasks" data-label="Việc">
        <b className="work-num">{g.tasks.done}/{g.tasks.total}</b><small>việc xong</small>
        {g.tasks.overdue > 0 && <span className="work-pill tone-rose">{g.tasks.overdue} quá hạn</span>}
      </span>
      <span className="work-goal-st"><GoalPill g={g} /></span>
    </button>
  );
}

/** Mục tiêu của đơn vị / công ty trong kỳ đang xem: quý → tháng; bấm để xem 4 phần. */
export function WorkGoalsCard({ goalsService, board, orgUnitId, scopeName, from, to, reloadKey, onOpen, onPush, onChanged }: {
  goalsService: WorkGoalService; board: GoalBoard; orgUnitId: string | null; scopeName: string; from: string; to: string; reloadKey: unknown;
  /** Mở ngăn mới (thay ngăn đang mở) / chồng thêm ngăn (có Quay lại). */
  onOpen: (v: DrawerView) => void; onPush: (v: DrawerView) => void;
  /** keepOpen: thay đổi nhỏ trong ngăn (gắn / bỏ việc) thì giữ ngăn. */
  onChanged: (message: string, keepOpen?: boolean) => void;
}) {
  const [data, setData] = useState<{ canEdit: boolean; goals: WorkGoal[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    goalsService.goals(orgUnitId, from, to).then((d) => { if (live) setData(d); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [goalsService, orgUnitId, from, to, reloadKey, retry]);

  const changed = (m: string, keepOpen?: boolean) => { onChanged(m, keepOpen); setRetry((v) => v + 1); };
  const ctx: Ctx = { goalsService, board, orgUnitId, scopeName, from, push: onPush, onChanged: changed };
  const tree = useMemo(() => goalTree(data?.goals || []), [data]);
  const counts = goalCounts(data?.goals || []);

  return (
    <section className="work-my-card" aria-label="Mục tiêu">
      <header>
        <h2><Target size={15} aria-hidden="true" /> Mục tiêu</h2>
        <div className="work-goal-head">
          {data && data.goals.length > 0 && (["met", "at_risk", "missed"] as const).filter((s) => counts[s]).map((s) => (
            <span key={s} className={`work-pill tone-${GOAL_STATUS[s].tone}`}>{counts[s]} {GOAL_STATUS[s].label.toLowerCase()}</span>
          ))}
          {data?.canEdit && <button type="button" className="work-secondary work-sm" onClick={() => onOpen(goalFormView(ctx, null))}><Plus size={15} /> Mục tiêu</button>}
        </div>
      </header>
      {error ? <p className="work-error work-pad" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setRetry((v) => v + 1)}>Thử lại</button></p>
        : !data ? <p className="work-hint work-pad"><Loader2 size={14} className="work-spin" /> Đang tải…</p>
        : !data.goals.length ? <p className="work-hint work-pad">Chưa có mục tiêu tháng / quý cho kỳ này.</p>
        : <div className="work-goals">{tree.map(({ goal, children }) => (
            <React.Fragment key={goal.id}>
              <GoalRow g={goal} onOpen={(g) => onOpen(goalView(ctx, g, data.canEdit))} />
              {children.map((c) => <GoalRow key={c.id} g={c} child onOpen={(g) => onOpen(goalView(ctx, g, data.canEdit))} />)}
            </React.Fragment>
          ))}</div>}
    </section>
  );
}

type Ctx = { goalsService: WorkGoalService; board: GoalBoard; orgUnitId: string | null; scopeName: string; from: string;
  push: (v: DrawerView) => void; onChanged: (message: string, keepOpen?: boolean) => void };

/** Ngăn một mục tiêu: Tiêu chí / Triển khai / Đánh giá / Giải pháp. */
export function goalView(ctx: Ctx, g: WorkGoal, canEdit: boolean): DrawerView {
  return {
    key: `g-${g.id}-${g.lockVersion}`, title: g.title, sub: [g.label, ctx.scopeName].join(" · "),
    body: <GoalDetail ctx={ctx} g={g} canEdit={canEdit} />,
    foot: canEdit ? <GoalActions ctx={ctx} g={g} /> : undefined,
  };
}

function GoalDetail({ ctx, g, canEdit }: { ctx: Ctx; g: WorkGoal; canEdit: boolean }) {
  return (
    <div className="work-goal-detail">
      <section className="work-goal-part">
        <h3><span>1</span> Tiêu chí</h3>
        <dl className="work-mini">
          <div><dt>Chỉ tiêu</dt><dd>{formatGoalValue(g.targetValue, g.measure)}{g.targetValue != null && !g.higherIsBetter && <small> càng thấp càng tốt</small>}</dd></div>
          <div><dt>Thực tế</dt><dd>{formatGoalValue(g.actualValue, g.measure)}</dd></div>
          <div><dt>Phụ trách</dt><dd className="work-mini-text">{g.owner?.name || "—"}</dd></div>
        </dl>
        {g.criteria && <p className="work-goal-text">{g.criteria}</p>}
      </section>
      <section className="work-goal-part">
        <h3><span>2</span> Triển khai <span className="work-count">{g.tasks.total}</span></h3>
        <GoalTasks ctx={ctx} g={g} canEdit={canEdit} />
      </section>
      <section className="work-goal-part">
        <h3><span>3</span> Đánh giá <GoalPill g={g} /></h3>
        <dl className="work-mini">
          <div><dt>Đạt chỉ tiêu</dt><dd>{g.achievedPercent == null ? "—" : `${g.achievedPercent}%`}</dd></div>
          <div><dt>Việc xong</dt><dd>{g.tasks.done}<small>/{g.tasks.total}</small></dd></div>
          <div><dt>Đúng hạn</dt><dd>{g.tasks.ontime}<small>/{g.tasks.ontime + g.tasks.late}</small></dd></div>
          <div><dt>Quá hạn</dt><dd className={g.tasks.overdue ? "tone-rose" : ""}>{g.tasks.overdue}</dd></div>
        </dl>
        {g.assessment ? <p className="work-goal-text">{g.assessment}</p> : <p className="work-hint">Chưa có lời đánh giá — ghi khi chốt kỳ.</p>}
      </section>
      <section className="work-goal-part">
        <h3><span>4</span> Giải pháp</h3>
        {g.solution ? <p className="work-goal-text">{g.solution}</p>
          : <p className="work-hint">{g.status === "missed" ? "Chưa đạt — cần ghi giải pháp khi chốt kỳ." : g.status === "met" ? "Không cần khi đạt." : "Ghi khi chốt kỳ nếu chưa đạt."}</p>}
      </section>
    </div>
  );
}

function GoalActions({ ctx, g }: { ctx: Ctx; g: WorkGoal }) {
  const [busy, setBusy] = useState<"split" | "delete" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const run = async (kind: "split" | "delete") => {
    setBusy(kind); setError("");
    try {
      if (kind === "split") { const r = await ctx.goalsService.splitGoal(g.id); ctx.onChanged(`Đã chia ${g.title} thành ${r.goals.length} tháng`); }
      else { await ctx.goalsService.deleteGoal(g.id, g.lockVersion); ctx.onChanged(`Đã xóa mục tiêu ${g.title}`); }
    } catch (e) { setError(workError(e)); } finally { setBusy(null); }
  };
  return (
    <div className="work-goal-foot">
      {error && <p className="work-error" role="alert">{error}</p>}
      <button type="button" className="work-primary" onClick={() => ctx.push(goalFormView(ctx, g))}>Sửa</button>
      {g.periodKind === "quarter" && <button type="button" className="work-secondary" disabled={!!busy} onClick={() => void run("split")}>
        {busy === "split" ? <Loader2 size={15} className="work-spin" /> : <Split size={15} />} Chia 3 tháng</button>}
      {confirm
        ? <><button type="button" className="work-danger" disabled={!!busy} onClick={() => void run("delete")}>{busy === "delete" && <Loader2 size={15} className="work-spin" />} Xóa hẳn</button>
            <button type="button" className="work-text-button" onClick={() => setConfirm(false)}>Hủy</button></>
        : <button type="button" className="work-text-button" onClick={() => setConfirm(true)} title={g.periodKind === "quarter" ? "Xóa cả mục tiêu tháng con" : undefined}><Trash2 size={14} /> Xóa</button>}
    </div>
  );
}

/** Việc triển khai của mục tiêu; người sửa được gắn / bỏ việc của đơn vị. */
function GoalTasks({ ctx, g, canEdit }: { ctx: Ctx; g: WorkGoal; canEdit: boolean }) {
  const [items, setItems] = useState<WorkGoalTask[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    let live = true;
    setError(null);
    ctx.goalsService.goalTasks(g.id).then((r) => { if (live) setItems(r.items || []); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [ctx.goalsService, g.id, tick]);
  const remove = async (taskId: string) => {
    try { await ctx.goalsService.setGoalTasks(g.id, [], [taskId]); setTick((v) => v + 1); ctx.onChanged("Đã bỏ việc khỏi mục tiêu", true); }
    catch (e) { setError(e); }
  };
  if (error) return <p className="work-error" role="alert">{workError(error)}</p>;
  if (!items) return <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải…</p>;
  return (
    <>
      {items.length ? <div className="work-tlines">{items.map((t) => {
        const due = t.completedAt ? { text: `${t.ontime === false ? "Xong trễ" : "Xong"} ${workDayLabel(t.completedAt)}`, tone: t.ontime === false ? "over" : "ok" }
          : workDueInfo(t.deadlineAt, t.status as never);
        return (
          <div key={t.id} className={`work-tline work-level-row level-${t.level}`}>
            <span className={`work-level-chip level-${t.level}`} title={WORK_LEVEL_LABELS[t.level]}>{t.level}</span>
            <span className="work-tline-main">
              {t.code ? <Link to={`/work/tasks/${encodeURIComponent(t.code)}`}><b>{t.title}</b></Link> : <b>{t.title}</b>}
              <span className="work-tline-meta">
                {t.assignees.length > 0 && <span>{t.assignees.map((a) => a.name).join(", ")}</span>}
                <span className={`work-due tone-${due.tone}`}><Clock3 size={12} aria-hidden="true" /> {due.text}</span>
                {!t.completedAt && <span className="work-row-progress"><span><i style={{ width: `${t.progressPercent}%` }} /></span><b>{t.progressPercent}%</b></span>}
              </span>
            </span>
            {canEdit && <button type="button" className="work-icon-button work-tline-x" aria-label={`Bỏ ${t.title}`} onClick={() => void remove(t.id)}><X size={15} /></button>}
          </div>
        );
      })}</div> : <p className="work-hint">Chưa gắn việc nào.</p>}
      {canEdit && (picking
        ? <TaskPicker ctx={ctx} goal={g} linked={new Set(items.map((t) => t.id))} onDone={(n) => { setPicking(false); if (n) { setTick((v) => v + 1); ctx.onChanged(`Đã gắn ${n} việc`, true); } }} />
        : <button type="button" className="work-secondary work-sm" onClick={() => setPicking(true)}><Plus size={15} /> Gắn việc</button>)}
    </>
  );
}

/** Chọn việc đang mở của đơn vị (theo quyền xem) để gắn vào mục tiêu. */
function TaskPicker({ ctx, goal, linked, onDone }: { ctx: Ctx; goal: WorkGoal; linked: Set<string>; onDone: (added: number) => void }) {
  const [items, setItems] = useState<WorkOverviewTask[] | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    ctx.board.tasksOverview({ unit: goal.unit?.code || null, state: "open", limit: 100 })
      .then((r) => { if (live) setItems((r.items || []).filter((t) => !linked.has(t.id))); }, (e) => { if (live) { setItems([]); setError(workError(e)); } });
    return () => { live = false; };
  }, [ctx.board, goal.unit?.code]);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
  const shown = (items || []).filter((t) => !q.trim() || norm(`${t.title} ${t.code} ${t.assignees.map((a) => a.name).join(" ")}`).includes(norm(q.trim())));
  const save = async () => {
    setBusy(true); setError("");
    try { await ctx.goalsService.setGoalTasks(goal.id, [...pick]); onDone(pick.size); } catch (e) { setError(workError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="work-goal-pick">
      <input className="work-input" autoFocus placeholder="Tìm việc theo tên, mã, người làm" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm việc" />
      {!items ? <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải việc…</p>
        : !shown.length ? <p className="work-hint">{items.length ? "Không có việc khớp." : "Không còn việc đang mở để gắn."}</p>
        : <div className="work-goal-pick-list">{shown.slice(0, 60).map((t) => (
            <label key={t.id} className={pick.has(t.id) ? "is-on" : ""}>
              <input type="checkbox" checked={pick.has(t.id)} onChange={() => setPick((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} />
              <span className={`work-level-chip level-${t.level}`}>{t.level}</span>
              <span><b>{t.title}</b><small>{[t.assignees.map((a) => a.name).join(", "), workDueInfo(t.deadlineAt, t.status).text].filter(Boolean).join(" · ")}</small></span>
            </label>
          ))}</div>}
      {error && <p className="work-error" role="alert">{error}</p>}
      <div className="work-goal-foot">
        <button type="button" className="work-primary" disabled={busy || !pick.size} onClick={() => void save()}>{busy ? <Loader2 size={15} className="work-spin" /> : <Check size={15} />} Gắn {pick.size || ""} việc</button>
        <button type="button" className="work-text-button" onClick={() => onDone(0)}>Hủy</button>
      </div>
    </div>
  );
}

/** Ngăn thêm / sửa mục tiêu. */
export function goalFormView(ctx: Ctx, g: WorkGoal | null): DrawerView {
  return { key: `gf-${g?.id || "new"}`, title: g ? "Sửa mục tiêu" : "Thêm mục tiêu", sub: ctx.scopeName, body: <GoalForm ctx={ctx} g={g} /> };
}

function GoalForm({ ctx, g }: { ctx: Ctx; g: WorkGoal | null }) {
  const options = useMemo(() => goalPeriodOptions(ctx.from), [ctx.from]);
  const [period, setPeriod] = useState(g ? `${g.periodKind}:${g.periodStart}` : `${options[0].kind}:${options[0].start}`);
  const [title, setTitle] = useState(g?.title || "");
  const [target, setTarget] = useState(g?.targetValue != null ? String(g.targetValue).replace(".", ",") : "");
  const [measure, setMeasure] = useState(g?.measure || "");
  const [higher, setHigher] = useState(g ? g.higherIsBetter : true);
  const [actual, setActual] = useState(g?.actualValue != null ? String(g.actualValue).replace(".", ",") : "");
  const [owner, setOwner] = useState(g?.owner?.id || "");
  const [criteria, setCriteria] = useState(g?.criteria || "");
  const [people, setPeople] = useState<WorkAssignablePerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    ctx.board.assignablePeople(null, 200).then((r) => { if (live) setPeople(r.people || []); }, () => undefined);
    return () => { live = false; };
  }, [ctx.board]);
  const targetN = parseGoalNumber(target); const actualN = parseGoalNumber(actual);
  const bad = title.trim().length < 3 || Number.isNaN(targetN) || Number.isNaN(actualN);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bad) return;
    setBusy(true); setError("");
    const [kind, start] = period.split(":") as ["month" | "quarter", string];
    const input: WorkGoalInput = g
      ? { id: g.id, title: title.trim(), criteria: criteria.trim() || null, targetValue: targetN, measure: measure.trim() || null, higherIsBetter: higher,
          actualValue: actualN, ownerUserId: owner || null, expectedLockVersion: g.lockVersion }
      : { id: null, orgUnitId: ctx.orgUnitId, periodKind: kind, periodStart: start, parentGoalId: null, title: title.trim(), criteria: criteria.trim() || null,
          targetValue: targetN, measure: measure.trim() || null, higherIsBetter: higher, actualValue: actualN, ownerUserId: owner || null };
    try {
      const saved = await ctx.goalsService.saveGoal(input);
      ctx.onChanged(g ? `Đã lưu ${saved.title}` : `Đã thêm mục tiêu ${saved.title}`);
    } catch (err) { setError(workError(err)); } finally { setBusy(false); }
  };
  return (
    <form className="work-goal-form" onSubmit={save}>
      <label className="work-label">Mục tiêu
        <input className="work-input" autoFocus maxLength={200} placeholder="VD: Thu tiền đợt 3 dự án SMB" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {!g && (
        <div className="work-label" role="group" aria-label="Kỳ">Kỳ
          <div className="work-goal-periods">{options.map((o) => (
            <button type="button" key={`${o.kind}:${o.start}`} aria-pressed={period === `${o.kind}:${o.start}`} onClick={() => setPeriod(`${o.kind}:${o.start}`)}>
              <CalendarRange size={14} aria-hidden="true" /> {o.label}</button>
          ))}</div>
        </div>
      )}
      <div className="work-goal-grid">
        <label className="work-label">Chỉ tiêu
          <input className="work-input" inputMode="decimal" placeholder="VD: 5" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={Number.isNaN(targetN)} />
        </label>
        <label className="work-label">Đơn vị đo
          <input className="work-input" list="work-goal-measures" maxLength={20} placeholder="tỷ, %, việc…" value={measure} onChange={(e) => setMeasure(e.target.value)} />
          <datalist id="work-goal-measures">{MEASURES.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="work-label">Thực tế
          <input className="work-input" inputMode="decimal" placeholder="Chưa có" value={actual} onChange={(e) => setActual(e.target.value)} aria-invalid={Number.isNaN(actualN)} />
        </label>
      </div>
      <div className="work-quick-seg" role="group" aria-label="Chiều chỉ tiêu">
        <button type="button" aria-pressed={higher} onClick={() => setHigher(true)}>Càng cao càng tốt</button>
        <button type="button" aria-pressed={!higher} onClick={() => setHigher(false)}>Càng thấp càng tốt</button>
      </div>
      <label className="work-label">Người phụ trách
        <select className="work-input work-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Chưa chọn</option>
          {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}{p.unit ? ` · ${p.unit.code || p.unit.name}` : ""}</option>)}
          {g?.owner && !people.some((p) => p.userId === g.owner!.id) && <option value={g.owner.id}>{g.owner.name}</option>}
        </select>
      </label>
      <label className="work-label">Mô tả tiêu chí <small>không bắt buộc</small>
        <textarea className="work-input" rows={2} maxLength={1000} placeholder="Cách đo, nguồn số liệu" value={criteria} onChange={(e) => setCriteria(e.target.value)} />
      </label>
      {(Number.isNaN(targetN) || Number.isNaN(actualN)) && <p className="work-error" role="alert">Chỉ tiêu / thực tế phải là số, VD 5 hoặc 1.250,5.</p>}
      {error && <p className="work-error" role="alert">{error}</p>}
      <div className="work-goal-foot">
        <button className="work-primary" disabled={busy || bad}>{busy ? <Loader2 size={15} className="work-spin" /> : <Check size={15} />} {g ? "Lưu" : "Thêm mục tiêu"}</button>
        {!g && period.startsWith("quarter") && <span className="work-hint">Thêm xong bấm “Chia 3 tháng” để có mục tiêu từng tháng.</span>}
      </div>
    </form>
  );
}

export { goalPeriodLabel };
export type { Ctx as GoalCtx };
