import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clock3, Inbox, Loader2, MessageSquare, UserCheck, UsersRound } from "lucide-react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { WorkBoardAccess, WorkBoardService, WorkDirective, WorkReviewItem, WorkTeamBoard as Team, WorkTeamMember } from "../../lib/work/workBoardService";
import { workError } from "../../lib/work/workForm";
import { directiveCounts, prevWeekStart, rateDelta, teamTotals, weekRangeLabel } from "../../lib/work/workBoards";
import { isoWeek } from "../../lib/work/workMyBoard";
import { BoardDrawer, BoardKpi, DeltaText, DirectiveItem, MemberTable, ReviewItem, TaskListLoader, personView, rateText, type DrawerView } from "./WorkBoardsUi";

/** Phòng tôi (trưởng đơn vị theo Sơ đồ tổ chức, Đợt 1 PR-4): 6 ô số, bảng người, chờ tôi duyệt, chỉ đạo BLĐ của đơn vị. */
export function WorkTeamBoard({ board, service, access, detailTo, onNotice, onAssignTo, children }: {
  board: Pick<WorkBoardService, "teamBoard" | "reviewQueue" | "directives" | "tasksOverview" | "decideClaimV2">;
  service: Pick<WorkTaskService, "command">;
  access: WorkBoardAccess;
  detailTo: (code: string) => string;
  onNotice: (message: string) => void;
  /** "Giao việc cho X" trong ngăn một người → điền sẵn ô Giao nhanh. */
  onAssignTo?: (userId: string) => void;
  /** Giao nhanh (đặt dưới ô số). */
  children?: React.ReactNode;
}) {
  const [unitId, setUnitId] = useState<string | null>(access.myUnits[0]?.id || null);
  const [team, setTeam] = useState<Team | null>(null);
  const [prev, setPrev] = useState<Team | null>(null);
  const [reviews, setReviews] = useState<WorkReviewItem[] | null>(null);
  const [dirs, setDirs] = useState<WorkDirective[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [stack, setStack] = useState<DrawerView[]>([]);

  useEffect(() => {
    let live = true;
    setError(null);
    board.teamBoard(unitId).then(async (t) => {
      if (!live) return;
      setTeam(t);
      const p = await board.teamBoard(t.unit.id, prevWeekStart(t.weekStart)).catch(() => null);
      if (live) setPrev(p);
    }, (e) => { if (live) setError(e); });
    board.reviewQueue().then((r) => { if (live) setReviews(r); }, () => { if (live) setReviews([]); });
    board.directives(unitId).then((d) => { if (live) setDirs(d); }, () => { if (live) setDirs([]); });
    return () => { live = false; };
  }, [board, unitId, reload]);

  const open = useCallback((v: DrawerView) => setStack([v]), []);

  if (error && !team) return <section className="work-my"><p className="work-error" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setReload((v) => v + 1)}>Thử lại</button></p></section>;
  if (!team) return <section className="work-my" aria-busy="true"><p className="work-hint" role="status"><Loader2 size={15} className="work-spin" /> Đang tải Phòng tôi…</p></section>;

  const tot = teamTotals(team.members);
  const prevRate = prev ? teamTotals(prev.members).rate : null;
  const unitQuery = team.unit.code || team.unit.name;
  const openDirs = (dirs || []).filter((d) => d.bucket === "late" || d.bucket === "doing");
  const lateDirs = (dirs || []).filter((d) => d.bucket === "late");
  const counts = directiveCounts(dirs || []);

  const listView = (key: string, title: string, state: "overdue" | "stale" | "unack"): DrawerView => ({
    key, title, sub: team.unit.name,
    body: <TaskListLoader board={board} filter={{ unit: unitQuery, state }} detailTo={detailTo} empty="Không có việc." />,
  });
  const pickMember = (m: WorkTeamMember) => open(personView(m, team.unit.name, board, detailTo, onAssignTo && !m.isHead ? (
    <button type="button" className="work-primary" onClick={() => { setStack([]); onAssignTo(m.userId); }}>Giao việc cho {m.name.split(" ").pop()}</button>
  ) : undefined));
  const decide = async (d: WorkDirective, decision: "confirm" | "reject", note: string | null, deadlineAt: string | null) => {
    await board.decideClaimV2(d.id, decision, note, deadlineAt);
    onNotice(decision === "confirm" ? `Đã xác nhận ${d.code}` : `Đã báo không giao ${d.code}`);
    setReload((v) => v + 1);
  };
  const review = async (r: WorkReviewItem, decision: "approve" | "request_changes", reason: string | null) => {
    await service.command({ taskId: r.id, command: "review", payload: decision === "approve" ? { decision } : { decision, reason: reason! },
      expectedLockVersion: r.lockVersion, idempotencyKey: crypto.randomUUID() } as never);
    onNotice(decision === "approve" ? `Đã duyệt ${r.code}` : `Đã trả lại ${r.code}`);
    setReload((v) => v + 1);
  };

  return (
    <section className="work-my" aria-label="Phòng tôi">
      <header className="work-my-head">
        <span className="work-my-icon" aria-hidden="true"><UsersRound size={22} /></span>
        <div className="work-my-title">
          <h1>{team.unit.name}</h1>
          <p>{team.members.length} người · số {weekRangeLabel(team.weekStart)}</p>
        </div>
        {access.myUnits.length > 1 && (
          <div className="work-my-actions">
            <select className="work-input" aria-label="Đơn vị" value={team.unit.id} onChange={(e) => setUnitId(e.target.value)}>
              {access.myUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
      </header>

      <div className="work-kpis is-six">
        <BoardKpi tone="ok" icon={<Check size={18} />} label={`Đúng hạn tuần ${isoWeek(team.weekStart)}`}
          value={<>{rateText(tot.rate)}{tot.due > 0 && <small> {tot.ontime}/{tot.due}</small>}</>}
          sub={tot.rate == null ? "chưa có việc đến hạn" : <DeltaText delta={rateDelta(tot.rate, prevRate)} week={isoWeek(prevWeekStart(team.weekStart))} />} />
        <BoardKpi tone="rose" icon={<AlertTriangle size={18} />} label="Quá hạn" value={tot.overdue} sub="việc đang trễ" onClick={() => open(listView("over", "Việc quá hạn", "overdue"))} />
        <BoardKpi tone="amber" icon={<Clock3 size={18} />} label="Lâu chưa cập nhật" value={tot.stale} sub="quá 2 ngày" onClick={() => open(listView("stale", "Lâu chưa cập nhật", "stale"))} />
        <BoardKpi tone="amber" icon={<Inbox size={18} />} label="Chờ tôi duyệt" value={reviews ? reviews.length : "…"} sub="kết quả đã nộp"
          onClick={() => document.getElementById("work-review-card")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        <BoardKpi tone="sky" icon={<UserCheck size={18} />} label="Chưa nhận việc" value={tot.unack} sub="chưa xác nhận" onClick={() => open(listView("unack", "Chưa nhận việc", "unack"))} />
        <BoardKpi tone="teal" icon={<MessageSquare size={18} />} label="Chỉ đạo BLĐ" value={<>{openDirs.length} <small>đang mở</small></>}
          sub={lateDirs.length ? <span className="work-down">{lateDirs.length} trễ</span> : "không có việc trễ"}
          onClick={() => open({ key: "dirs", title: "Chỉ đạo BLĐ", sub: team.unit.name,
            body: (dirs || []).length ? <div className="work-dirs">{(dirs || []).filter((d) => d.bucket !== "done").map((d) => <DirectiveItem key={d.id} d={d} to={detailTo(d.code)} onDecide={decide} />)}</div>
              : <p className="work-hint">Chưa có chỉ đạo nào giao cho đơn vị.</p> })} />
      </div>

      {children}

      <div className="work-my-cols">
        <div className="work-my-main">
          <section className="work-my-card">
            <header><h2>Nhân viên</h2><span>Bấm một người để xem việc</span></header>
            <MemberTable members={team.members} onPick={pickMember} />
          </section>
          {counts.confirm > 0 && (
            <section className="work-my-card">
              <header><h2>Việc giao miệng chờ xác nhận</h2><span>{counts.confirm} việc</span></header>
              <div className="work-dirs">{(dirs || []).filter((d) => d.bucket === "confirm").map((d) => <DirectiveItem key={d.id} d={d} to={detailTo(d.code)} onDecide={decide} />)}</div>
            </section>
          )}
        </div>
        <aside className="work-my-side">
          <section className="work-my-card work-sticky" id="work-review-card" aria-label="Chờ tôi duyệt">
            <header><h2>Chờ tôi duyệt</h2><span className="work-count tone-today">{reviews ? reviews.length : "…"}</span></header>
            <div className="work-dirs">
              {!reviews ? <p className="work-hint"><Loader2 size={14} className="work-spin" /> Đang tải…</p>
                : reviews.length ? reviews.map((r) => <ReviewItem key={r.id} r={r} to={detailTo(r.code)} onReview={review} />)
                : <p className="work-hint">Không còn kết quả chờ duyệt.</p>}
            </div>
          </section>
        </aside>
      </div>
      <BoardDrawer stack={stack} onBack={() => setStack((s) => s.slice(0, -1))} onClose={() => setStack([])} />
    </section>
  );
}
