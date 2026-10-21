import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Check, Loader2, MessageSquare, PenLine, UserX } from "lucide-react";
import type { WorkCompanyBoard as Company, WorkCompanyUnit, WorkBoardService, WorkDirective, WorkDirectiveBucket, WorkTeamMember } from "../../lib/work/workBoardService";
import { ontimeRate } from "../../lib/work/workBoardService";
import { workError } from "../../lib/work/workForm";
import {
  DIRECTIVE_TABS, companyTotals, directiveCounts, directivesDone, directivesOfUnit, rateDelta, unitSections, type UnitSort,
} from "../../lib/work/workBoards";
import { periodLabel, periodQuery, periodShort, prevShort, type WorkPeriodQuery } from "../../lib/work/workPeriod";
import { WorkPeriodPicker, useWorkPeriod } from "./WorkPeriodPicker";
import { BoardDrawer, BoardKpi, DeltaText, DirectiveItem, MemberTable, MiniStats, NoHeadWarning, personView, rateText, type DrawerView } from "./WorkBoardsUi";

const SORTS: Array<{ id: UnitSort; label: string }> = [{ id: "group", label: "Theo khối" }, { id: "rate", label: "Đúng hạn thấp" }, { id: "overdue", label: "Quá hạn nhiều" }];

/** Toàn công ty (BLĐ, Đợt 1 PR-4): đơn vị theo khối (bấm → người → việc), Sổ chỉ đạo (Trễ / Đang làm / Chờ xác nhận / Xong), đơn vị chưa gán trưởng. */
export function WorkCompanyBoard({ board, detailTo, onNotice, headerActions, children }: {
  board: Pick<WorkBoardService, "companyBoard" | "teamBoard" | "directives" | "tasksOverview" | "decideClaimV2">;
  detailTo: (code: string) => string;
  onNotice: (message: string) => void;
  /** Nút "Ghi chỉ đạo" (mở Giao từ biên bản). */
  headerActions?: React.ReactNode;
  /** Khung Ghi chỉ đạo khi mở. */
  children?: React.ReactNode;
}) {
  const [period, setPeriod, today] = useWorkPeriod();
  const query = periodQuery(period, today);
  const [company, setCompany] = useState<Company | null>(null);
  const [dirs, setDirs] = useState<WorkDirective[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [sort, setSort] = useState<UnitSort>("group");
  const [noHead, setNoHead] = useState(false);
  const [tab, setTab] = useState<WorkDirectiveBucket>("late");
  const [stack, setStack] = useState<DrawerView[]>([]);

  useEffect(() => {
    let live = true;
    setError(null);
    board.companyBoard(query).then((c) => { if (live) setCompany(c); }, (e) => { if (live) setError(e); });
    board.directives(null, query).then((d) => { if (live) setDirs(d); }, () => { if (live) setDirs([]); });
    return () => { live = false; };
  }, [board, reload, query.from, query.to, query.prevFrom, query.prevTo]);

  const sections = useMemo(() => (company ? unitSections(company.units, sort, noHead) : []), [company, sort, noHead]);
  const push = useCallback((v: DrawerView) => setStack((s) => [...s, v]), []);

  if (error && !company) return <section className="work-my"><p className="work-error" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setReload((v) => v + 1)}>Thử lại</button></p></section>;
  if (!company) return <section className="work-my" aria-busy="true"><p className="work-hint" role="status"><Loader2 size={15} className="work-spin" /> Đang tải Toàn công ty…</p></section>;

  const tot = companyTotals(company.units);
  const range = { from: query.from, to: query.to, label: periodShort(period) };
  const counts = directiveCounts(dirs || []);
  const dirTotal = counts.late + counts.doing + counts.done;
  const shown = (dirs || []).filter((d) => d.bucket === tab);

  const decide = async (d: WorkDirective, decision: "confirm" | "reject", note: string | null, deadlineAt: string | null) => {
    await board.decideClaimV2(d.id, decision, note, deadlineAt);
    onNotice(decision === "confirm" ? `Đã xác nhận ${d.code}${deadlineAt ? " · đổi hạn" : ""}` : `Đã báo không giao ${d.code}`);
    setReload((v) => v + 1);
  };
  const unitView = (u: WorkCompanyUnit): DrawerView => {
    const rate = ontimeRate(u.ontime, u.due);
    const open = directivesOfUnit(dirs || [], u.code).filter((d) => d.bucket !== "done");
    return {
      key: `u-${u.id}`, title: u.name, sub: [u.code, `${u.people} người`, u.parent?.name].filter(Boolean).join(" · "),
      body: <>
        {!u.hasHead && <NoHeadWarning />}
        <MiniStats items={[["Đúng hạn", <>{rateText(rate)}{u.due > 0 && <small> {u.ontime}/{u.due}</small>}</>], ["Quá hạn", u.overdue, u.overdue ? "rose" : undefined],
          ["Chưa cập nhật", u.stale, u.stale ? "amber" : undefined], ["Chỉ đạo", `${directivesDone(u)}/${u.directives.open + directivesDone(u)}`, u.directives.late ? "rose" : undefined]]} />
        {open.length > 0 && <><h3 className="work-my-group-h">Chỉ đạo đang mở <span className="work-count">{open.length}</span></h3>
          <div className="work-dirs">{open.map((d) => <DirectiveItem key={d.id} d={d} to={detailTo(d.code)} onDecide={decide} />)}</div></>}
        <h3 className="work-my-group-h">Nhân viên</h3>
        <UnitMembers board={board} unit={u} period={query} onPick={(m) => push(personView(m, u.name, board, detailTo, undefined, range))} />
      </>,
    };
  };

  return (
    <section className="work-my" aria-label="Toàn công ty">
      <header className="work-my-head">
        <span className="work-my-icon" aria-hidden="true"><Building2 size={22} /></span>
        <div className="work-my-title">
          <h1>Toàn công ty</h1>
          <p>{tot.units} đơn vị · {tot.people} người</p>
        </div>
        <div className="work-my-actions"><WorkPeriodPicker period={period} today={today} onChange={setPeriod} />{headerActions}</div>
      </header>

      <div className="work-kpis">
        <BoardKpi tone="ok" icon={<Check size={18} />} label={`Đúng hạn ${periodShort(period)}`} title={`${periodLabel(period)} · bấm để xếp đơn vị đúng hạn thấp lên đầu`}
          value={<>{rateText(tot.rate)}{tot.due > 0 && <small> {tot.ontime}/{tot.due}</small>}</>}
          sub={tot.rate == null ? "chưa có việc đến hạn" : <DeltaText delta={rateDelta(tot.rate, tot.prevRate)} vs={prevShort(period)} />}
          pressed={sort === "rate"} onClick={() => setSort((s) => (s === "rate" ? "group" : "rate"))} />
        <BoardKpi tone="rose" icon={<AlertTriangle size={18} />} label="Quá hạn" value={tot.overdue} sub="việc đang trễ" pressed={sort === "overdue"}
          onClick={() => setSort((s) => (s === "overdue" ? "group" : "overdue"))} title="Xếp đơn vị quá hạn nhiều lên đầu" />
        <BoardKpi tone="teal" icon={<MessageSquare size={18} />} label="Chỉ đạo BLĐ" value={<>{counts.done}/{dirTotal} <small>xong</small></>}
          sub={<><span className={counts.late ? "work-down" : ""}>{counts.late} trễ</span> · {counts.doing} đang làm</>} pressed={tab === "late"}
          onClick={() => { setTab("late"); document.getElementById("work-dir-card")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
        <BoardKpi tone="amber" icon={<PenLine size={18} />} label="Chờ BLĐ xác nhận" value={counts.confirm} sub="việc giao miệng" pressed={tab === "confirm"}
          onClick={() => { setTab("confirm"); document.getElementById("work-dir-card")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
        <BoardKpi tone="rose" icon={<UserX size={18} />} label="Chưa gán trưởng BP" value={tot.noHead} sub={`trên ${tot.units} đơn vị`} pressed={noHead}
          onClick={() => setNoHead((v) => !v)} title={noHead ? "Bỏ lọc" : "Chỉ xem đơn vị chưa gán trưởng"} />
      </div>

      {children}

      <div className="work-cols-company">
        <section className="work-my-card">
          <header>
            <h2>Đơn vị {noHead && <button type="button" className="work-pill tone-rose work-pill-x" onClick={() => setNoHead(false)}>Chưa gán trưởng BP ×</button>}</h2>
            <div className="work-quick-seg" role="group" aria-label="Sắp xếp">
              {SORTS.map((s) => <button type="button" key={s.id} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>{s.label}</button>)}
            </div>
          </header>
          <div className="work-units" role="table" aria-label="Đơn vị">
            <div className="work-units-h" role="row"><span>Đơn vị</span><span>Người</span><span>Đúng hạn</span><span>±</span><span>Quá hạn</span><span>Chỉ đạo</span></div>
            {sections.map((sec) => (
              <React.Fragment key={sec.title || "all"}>
                {sec.title && <div className="work-units-g" role="row">{sec.title} · {sec.units.length} đơn vị · {sec.units.reduce((n, u) => n + u.people, 0)} người</div>}
                {sec.units.map((u) => {
                  const rate = ontimeRate(u.ontime, u.due);
                  const delta = u.due >= 3 && u.prevDue != null ? rateDelta(rate, ontimeRate(u.prevOntime || 0, u.prevDue)) : null;
                  return (
                    <button type="button" key={u.id} className="work-units-r" role="row" onClick={() => setStack([unitView(u)])}>
                      <span className="work-units-name"><b>{u.name}</b><small>{u.code}{!u.hasHead && <em> · Chưa gán trưởng BP</em>}</small></span>
                      <span data-label="Người" className="work-num">{u.people}</span>
                      <span data-label="Đúng hạn" title={u.due < 3 && u.due > 0 ? `Chỉ ${u.due} việc đến hạn, đọc kèm số việc` : undefined}>
                        <span className="work-my-bar"><i className={rate != null && rate < 70 ? "is-low" : ""} style={{ width: `${rate ?? 0}%` }} /></span>
                        <b className="work-num">{rateText(rate)}</b><small className="work-num">{u.due ? `${u.ontime}/${u.due}` : "—"}</small></span>
                      <span data-label="±" className="work-num">{delta == null ? <span className="work-muted">—</span> : <span className={delta >= 0 ? "work-up" : "work-down"}>{delta >= 0 ? "+" : ""}{delta}</span>}</span>
                      <span data-label="Quá hạn">{u.overdue ? <span className="work-pill tone-rose">{u.overdue}</span> : <span className="work-muted">0</span>}</span>
                      <span data-label="Chỉ đạo" className="work-num">{u.directives.open + directivesDone(u)
                        ? <>{directivesDone(u)}/{u.directives.open + directivesDone(u)}{u.directives.late > 0 && <span className="work-pill tone-rose">{u.directives.late} trễ</span>}</>
                        : <span className="work-muted">—</span>}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
            {!sections.some((s) => s.units.length) && <p className="work-hint">Không có đơn vị.</p>}
          </div>
        </section>

        <section className="work-my-card work-sticky" id="work-dir-card" aria-label="Sổ chỉ đạo BLĐ">
          <header><h2>Sổ chỉ đạo BLĐ</h2><span>{(dirs || []).length} việc · xong {periodShort(period)}</span></header>
          <div className="work-dir-tabs" role="tablist">
            {DIRECTIVE_TABS.map((t) => (
              <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label} <span className={`work-count tone-${t.id === "late" ? "over" : t.id === "confirm" ? "confirm" : ""}`}>{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="work-dirs">
            {!dirs ? <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải…</p>
              : shown.length ? shown.map((d) => <DirectiveItem key={d.id} d={d} to={detailTo(d.code)} onDecide={decide} />)
              : <p className="work-hint">{tab === "late" ? "Không có chỉ đạo trễ." : tab === "confirm" ? "Không có việc chờ xác nhận." : "Không có việc."}</p>}
          </div>
        </section>
      </div>
      <BoardDrawer stack={stack} onBack={() => setStack((s) => s.slice(0, -1))} onClose={() => setStack([])} />
    </section>
  );
}

/** Nhân viên của một đơn vị (BLĐ xem được mọi đơn vị). */
function UnitMembers({ board, unit, period, onPick }: {
  board: Pick<WorkBoardService, "teamBoard">; unit: WorkCompanyUnit; period: WorkPeriodQuery; onPick: (m: WorkTeamMember) => void;
}) {
  const [members, setMembers] = useState<WorkTeamMember[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    board.teamBoard(unit.id, period).then((t) => { if (live) setMembers(t.members); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [board, unit.id, period.from, period.to, period.prevFrom, period.prevTo]);
  if (error) return <p className="work-error" role="alert">{workError(error)}</p>;
  if (!members) return <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải…</p>;
  return <MemberTable members={members} onPick={onPick} />;
}
