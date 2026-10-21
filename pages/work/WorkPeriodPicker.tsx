import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { localIsoDate } from "../../lib/work/workAiText";
import {
  WORK_PERIOD_PRESETS, customPeriod, periodFromRange, periodLabel, presetPeriod, restorePeriod, storePeriod, type WorkPeriod, type WorkPeriodPreset,
} from "../../lib/work/workPeriod";

const KEY = "work.period";

/** Kỳ đang xem, nhớ chung cho Việc của tôi / Phòng tôi / Toàn công ty. Link bản tin (?from&to) thắng kỳ đã nhớ. */
export function useWorkPeriod(link?: { from: string | null; to: string | null } | null): [WorkPeriod, (p: WorkPeriod) => void, string] {
  const today = localIsoDate(new Date());
  const [period, setPeriod] = useState<WorkPeriod>(() => {
    const linked = link ? periodFromRange(link.from, link.to, today) : null;
    if (linked) return linked;
    let raw: string | null = null;
    try { raw = localStorage.getItem(KEY); } catch { /* bỏ qua */ }
    return restorePeriod(raw, today);
  });
  const choose = useCallback((p: WorkPeriod) => {
    setPeriod(p);
    try { localStorage.setItem(KEY, storePeriod(p)); } catch { /* bỏ qua */ }
  }, []);
  return [period, choose, today];
}

/** Nút chọn kỳ: bấm mở bảng 6 kỳ; Tùy chọn thì chọn từ ngày – đến ngày rồi Áp dụng. */
export function WorkPeriodPicker({ period, today, onChange }: { period: WorkPeriod; today: string; onChange: (p: WorkPeriod) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(period.preset === "custom");
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to > today ? today : period.to);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); window.removeEventListener("keydown", key); };
  }, [open]);

  const toggle = () => {
    setOpen((v) => !v);
    setCustom(period.preset === "custom");
    setFrom(period.from); setTo(period.to > today ? today : period.to);
  };
  const pick = (id: WorkPeriodPreset) => {
    if (id === "custom") { setCustom(true); return; }
    onChange(presetPeriod(id, today)); setOpen(false);
  };
  const applied = customPeriod(from, to, today);

  return (
    <div className="work-period" ref={box}>
      <button type="button" className="work-period-btn" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <CalendarRange size={16} aria-hidden="true" />
        <span>{periodLabel(period)}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="work-period-pop" role="dialog" aria-label="Chọn kỳ">
          <div className="work-period-grid">
            {WORK_PERIOD_PRESETS.map((p) => {
              const on = custom ? p.id === "custom" : period.preset === p.id;
              return (
                <button type="button" key={p.id} aria-pressed={on} onClick={() => pick(p.id)}>
                  <b>{p.label}</b>
                  <small>{p.id === "custom" ? "Từ ngày – đến ngày" : periodLabel(presetPeriod(p.id, today))}</small>
                  {on && <Check size={14} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {custom && (
            <form className="work-period-custom" onSubmit={(e) => { e.preventDefault(); if (applied) { onChange(applied); setOpen(false); } }}>
              <label>Từ<input className="work-input" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>Đến<input className="work-input" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
              <button className="work-primary" disabled={!applied}>Áp dụng</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
