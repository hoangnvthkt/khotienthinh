import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock3, Download, Expand, Loader2, Lock, MessageSquare, Shrink, Target, X } from "lucide-react";
import type { WorkBoardService } from "../../lib/work/workBoardService";
import { workError } from "../../lib/work/workForm";
import { workDueInfo } from "../../lib/work/workPresentation";
import { GOAL_STATUS, formatGoalValue, type WorkGoalService } from "../../lib/work/workGoals";
import { directiveSource } from "../../lib/work/workBoards";
import type { WorkPeriodQuery } from "../../lib/work/workPeriod";
import { localIsoDate } from "../../lib/work/workAiText";
import {
  buildSlides, loadWorkReport, reportDirectiveCounts, reportGoalCounts, type ReportRow, type ReportSlide, type WorkReportData,
} from "../../lib/work/workReport";

const W = 1280, H = 720;
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const when = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export interface ReportScope {
  orgUnitId: string | null; unitCode: string | null; scopeName: string; label: string; from: string; to: string; query: WorkPeriodQuery;
}

/** Báo cáo kỳ: trình chiếu toàn màn hình (← → / Esc, vuốt trên điện thoại) + Tải PDF (in trình duyệt, mỗi slide một trang). */
export function WorkPeriodReport({ board, goals, scope, onClose }: {
  board: Pick<WorkBoardService, "teamBoard" | "companyBoard" | "directives" | "tasksOverview">; goals: WorkGoalService; scope: ReportScope; onClose: () => void;
}) {
  const [data, setData] = useState<WorkReportData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const [scale, setScale] = useState(1);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setError(null); setData(null);
    loadWorkReport({ board, goals }, scope).then((d) => { if (live) { setData(d); setI(0); } }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [board, goals, scope.orgUnitId, scope.from, scope.to, retry]);

  const slides = data ? buildSlides(data) : [];
  const go = useCallback((d: number) => setI((v) => Math.max(0, Math.min(slides.length - 1, v + d))), [slides.length]);

  const exitFull = useCallback(() => {
    const doc = document as Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element };
    if (document.fullscreenElement || doc.webkitFullscreenElement) (document.exitFullscreen?.bind(document) || doc.webkitExitFullscreen?.bind(doc))?.();
    setFull(false);
  }, []);
  const toggleFull = () => {
    if (full) { exitFull(); return; }
    const el = root.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const req = el?.requestFullscreen?.bind(el) || el?.webkitRequestFullscreen?.bind(el);
    setFull(true);
    try { const r = req?.(); if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => undefined); } catch { /* iPhone: giữ toàn khung */ }
  };
  useEffect(() => {
    const onFs = () => { const doc = document as Document & { webkitFullscreenElement?: Element }; if (!document.fullscreenElement && !doc.webkitFullscreenElement) setFull(false); };
    document.addEventListener("fullscreenchange", onFs); document.addEventListener("webkitfullscreenchange", onFs);
    return () => { document.removeEventListener("fullscreenchange", onFs); document.removeEventListener("webkitfullscreenchange", onFs); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(Math.max(0, slides.length - 1));
      else if (e.key === "Escape") { if (full) exitFull(); else onClose(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, full, exitFull, onClose, slides.length]);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setScale(Math.max(0.1, Math.min(w / W, h / H)));
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [data]);
  // Khổ in 16:9 chỉ khi đang mở báo cáo (bản in module khác giữ @page mặc định).
  useEffect(() => {
    document.body.classList.add("work-deck-open");
    const page = document.createElement("style");
    page.textContent = "@media print { @page { size: 1280px 720px; margin: 0; } }";
    document.head.appendChild(page);
    return () => { document.body.classList.remove("work-deck-open"); page.remove(); };
  }, []);

  const print = () => { exitFull(); setTimeout(() => window.print(), 60); };

  return (
    <div ref={root} className={`work-deck${full ? " is-full" : ""}`} role="dialog" aria-modal="true" aria-label={`Báo cáo ${scope.label}`}>
      <header className="work-deck-bar">
        <div className="work-deck-title"><b>Báo cáo {scope.label}</b><span>{scope.scopeName}</span></div>
        {data && <span className="work-deck-count work-num">{i + 1}/{slides.length}</span>}
        <div className="work-deck-acts">
          <button type="button" className="work-icon-button" aria-label="Slide trước" disabled={!data || i === 0} onClick={() => go(-1)}><ChevronLeft size={18} /></button>
          <button type="button" className="work-icon-button" aria-label="Slide sau" disabled={!data || i >= slides.length - 1} onClick={() => go(1)}><ChevronRight size={18} /></button>
          <button type="button" className="work-secondary work-sm" disabled={!data} onClick={toggleFull}>{full ? <Shrink size={15} /> : <Expand size={15} />} {full ? "Thoát" : "Trình chiếu"}</button>
          <button type="button" className="work-secondary work-sm" disabled={!data} onClick={print} title="Chọn “Lưu dưới dạng PDF” trong hộp in"><Download size={15} /> Tải PDF</button>
          <button type="button" className="work-icon-button" aria-label="Đóng báo cáo" onClick={() => { exitFull(); onClose(); }}><X size={18} /></button>
        </div>
      </header>
      <div ref={stage} className="work-deck-stage"
        onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => { const x0 = touch.current; const x1 = e.changedTouches[0]?.clientX; touch.current = null;
          if (x0 != null && x1 != null && Math.abs(x1 - x0) > 50) go(x1 < x0 ? 1 : -1); }}>
        {error ? <p className="work-error" role="alert">{workError(error)} <button className="work-text-button" onClick={() => setRetry((v) => v + 1)}>Thử lại</button></p>
          : !data ? <p className="work-hint"><Loader2 size={15} className="work-spin" /> Đang dựng báo cáo…</p>
          : <div className="work-slide-frame" style={{ width: W * scale, height: H * scale }}>
              <div className="work-slide-scale" style={{ transform: `scale(${scale})` }}><Slide s={slides[i]} d={data} n={i + 1} total={slides.length} /></div>
            </div>}
      </div>
      {data && <nav className="work-deck-dots" aria-label="Chọn slide">{slides.map((s, k) => (
        <button type="button" key={k} aria-current={k === i ? "true" : undefined} aria-label={`Slide ${k + 1}`} onClick={() => setI(k)} />
      ))}</nav>}
      {data && createPortal(
        <div className="work-print-root" aria-hidden="true">{slides.map((s, k) => <div className="work-print-page" key={k}><Slide s={s} d={data} n={k + 1} total={slides.length} /></div>)}</div>,
        document.body)}
    </div>
  );
}

// ── Slide ───────────────────────────────────────────────────────────────────────────────────────────
/** Trạng thái số: đã chốt / kỳ còn chạy (tạm tính) / kỳ đã qua nhưng chưa chốt. */
const openLabel = (d: WorkReportData) => (d.to >= localIsoDate(new Date()) ? "Kỳ đang mở · số tạm tính" : "Chưa chốt · số tính trực tiếp");

function Slide({ s, d, n, total }: { s: ReportSlide; d: WorkReportData; n: number; total: number }) {
  const foot = <footer className="work-slide-foot"><span>Vioo Work · {d.scopeName} · {d.label}</span>
    <span>{d.closed ? <><Lock size={12} aria-hidden="true" /> Đã chốt {when(d.closed.at)}</> : openLabel(d)}</span><span>{n}/{total}</span></footer>;
  const head = (title: string, sub?: string) => <header className="work-slide-head"><h2>{title}</h2>{sub && <p>{sub}</p>}</header>;
  const who = d.kind === "company" ? "đơn vị" : "người";
  switch (s.kind) {
    case "cover": {
      const dc = reportDirectiveCounts(d); const gc = reportGoalCounts(d);
      return (
        <section className="work-slide is-cover">
          <div className="work-slide-cover">
            <p className="work-slide-kicker">Báo cáo kỳ</p>
            <h1>{d.scopeName}</h1>
            <p className="work-slide-period">{d.label}</p>
            <span className={`work-slide-state${d.closed ? " is-closed" : ""}`}>{d.closed ? <><Lock size={16} /> Đã chốt {when(d.closed.at)} · {d.closed.by}</> : openLabel(d)}</span>
          </div>
          <div className="work-slide-kpis">
            <Kpi label="Đúng hạn" value={pct(d.rate)} sub={d.due ? `${d.ontime}/${d.due} việc` : "chưa có việc đến hạn"}
              extra={d.delta == null ? null : <span className={d.delta >= 0 ? "work-up" : "work-down"}>{d.delta >= 0 ? "+" : ""}{d.delta} điểm so với kỳ trước</span>} tone="ok" />
            <Kpi label="Đang quá hạn" value={String(d.overdue)} sub="việc chưa xong" tone={d.overdue ? "rose" : "muted"} />
            <Kpi label="Chỉ đạo BLĐ" value={`${dc.done}/${dc.done + dc.doing + dc.late}`} sub={dc.late ? `${dc.late} trễ` : "không có việc trễ"} tone={dc.late ? "amber" : "teal"} />
            <Kpi label="Mục tiêu đạt" value={gc.total ? `${gc.met}/${gc.total}` : "—"} sub={gc.risk ? `${gc.risk} cần chú ý` : gc.total ? "đúng hướng" : "chưa đặt mục tiêu"} tone={gc.risk ? "amber" : "teal"} />
          </div>
          {foot}
        </section>
      );
    }
    case "rows":
      return (
        <section className="work-slide">
          {head(`Đúng hạn theo ${who}`, "Xếp từ thấp đến cao · thanh = % việc xong đúng hạn trong kỳ")}
          <div className="work-slide-rows">{s.rows.map((r) => <RateRow key={r.id} r={r} />)}</div>
          {foot}
        </section>
      );
    case "worst":
      return (
        <section className="work-slide">
          {head(`${d.kind === "company" ? "Đơn vị" : "Người"} trễ nhiều nhất`, "Không đúng hạn trong kỳ + đang quá hạn")}
          <div className="work-slide-worst">{s.rows.map((r, k) => (
            <article key={r.id}>
              <span className="work-slide-rank">{k + 1}</span>
              <div><b>{r.name}</b>{r.sub && <small>{r.sub}</small>}</div>
              <dl>
                <div><dt>Không đúng hạn</dt><dd className={r.late ? "tone-amber" : ""}>{r.late}</dd></div>
                <div><dt>Đang quá hạn</dt><dd className={r.overdue ? "tone-rose" : ""}>{r.overdue}</dd></div>
                <div><dt>Đúng hạn</dt><dd>{pct(r.rate)}</dd></div>
              </dl>
            </article>
          ))}</div>
          {foot}
        </section>
      );
    case "goals":
      return (
        <section className="work-slide">
          {head("Mục tiêu", s.pages > 1 ? `Trang ${s.page}/${s.pages}` : "Tiêu chí · Triển khai · Đánh giá · Giải pháp")}
          <div className="work-slide-goals">{s.goals.map((g) => (
            <article key={g.id} className={`tone-${GOAL_STATUS[g.status].tone}`}>
              <header><Target size={16} aria-hidden="true" /><b>{g.title}</b><small>{g.label}</small><span className={`work-pill tone-${GOAL_STATUS[g.status].tone}`}>{GOAL_STATUS[g.status].label}</span></header>
              <div className="work-slide-goal-val">
                <span className="work-goal-bar is-wide"><i className={`tone-${GOAL_STATUS[g.status].tone}`} style={{ width: `${Math.min(100, g.achievedPercent ?? 0)}%` }} /></span>
                <b className="work-num">{pct(g.achievedPercent)}</b>
                <small>{formatGoalValue(g.actualValue, null)} / {formatGoalValue(g.targetValue, g.measure)} · {g.tasks.done}/{g.tasks.total} việc xong{g.tasks.overdue ? ` · ${g.tasks.overdue} quá hạn` : ""}</small>
              </div>
              {g.assessment && <p><em>Đánh giá</em>{g.assessment}</p>}
              {g.solution && <p><em>Giải pháp</em>{g.solution}</p>}
            </article>
          ))}</div>
          {foot}
        </section>
      );
    case "directives":
      return (
        <section className="work-slide">
          {head("Chỉ đạo BLĐ", "Trễ trước · đang làm · chờ xác nhận")}
          <div className="work-slide-list">{s.items.map((x) => {
            const due = workDueInfo(x.deadlineAt, x.status);
            return (
              <article key={x.id} className={x.bucket === "late" ? "is-late" : ""}>
                <span className={`work-level-chip level-${x.level}`}>{x.level}</span>
                <div><b>{x.title}</b><small><MessageSquare size={12} aria-hidden="true" /> {directiveSource(x)} · {x.assignees.map((a) => a.name).join(", ") || "—"}</small></div>
                <span className={`work-due tone-${due.tone}`}><Clock3 size={13} aria-hidden="true" /> {due.text}</span>
                <span className="work-num">{x.progressPercent}%</span>
              </article>
            );
          })}</div>
          {foot}
        </section>
      );
    case "late":
      return (
        <section className="work-slide">
          {head("Việc đang quá hạn", "Cần người phụ trách xử lý / cập nhật")}
          <div className="work-slide-list">{s.items.map((t) => {
            const due = workDueInfo(t.deadlineAt, t.status);
            return (
              <article key={t.id} className="is-late">
                <span className={`work-level-chip level-${t.level}`}>{t.level}</span>
                <div><b>{t.title}</b><small>{t.assignees.map((a) => a.name).join(", ") || "—"}</small></div>
                <span className={`work-due tone-${due.tone}`}><AlertTriangle size={13} aria-hidden="true" /> {due.text}</span>
                <span className="work-num">{t.progressPercent}%</span>
              </article>
            );
          })}</div>
          {foot}
        </section>
      );
    case "note":
      return (
        <section className="work-slide">
          {head("Nhận xét kỳ", d.closed ? `${d.closed.by} · chốt ${when(d.closed.at)}` : undefined)}
          <blockquote className="work-slide-note">{s.note}</blockquote>
          {foot}
        </section>
      );
  }
}

const Kpi = ({ label, value, sub, extra, tone }: { label: string; value: string; sub: string; extra?: React.ReactNode; tone: string }) => (
  <div className={`work-slide-kpi tone-${tone}`}><span>{label}</span><b className="work-num">{value}</b><small>{sub}</small>{extra && <em>{extra}</em>}</div>
);

function RateRow({ r }: { r: ReportRow }) {
  const tone = r.rate == null ? "muted" : r.rate < 70 ? "rose" : r.rate < 85 ? "amber" : "ok";
  return (
    <div className="work-slide-rate">
      <span className="work-slide-rate-name"><b>{r.name}</b>{r.sub && <small>{r.sub}</small>}</span>
      <span className="work-slide-rate-bar"><i className={`tone-${tone}`} style={{ width: `${r.rate ?? 0}%` }} /></span>
      <b className="work-num">{pct(r.rate)}</b>
      <small className="work-num">{r.due ? `${r.ontime}/${r.due}` : "—"}</small>
      <span className="work-num">{r.overdue ? <span className="work-pill tone-rose">{r.overdue} quá hạn</span> : ""}</span>
    </div>
  );
}
