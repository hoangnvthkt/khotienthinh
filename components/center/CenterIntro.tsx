import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanelsTopLeft } from 'lucide-react';
import { Greeting, type CenterPerson } from './TodayView';

// Lời chào khi vừa bật giao diện Trung tâm điều hành: lời chào hiện lên nhẹ nhàng, rồi màn che mờ dần
// trong lúc Trung tâm điều hành hiện ra. Chỉ dùng transition opacity / transform, chạy một lần
// (docs/ui/VIOO-UI-UX.md mục 6); bấm / phím bất kỳ để bỏ qua; người giảm chuyển động → vào thẳng.

const HOLD_MS = 1400;
const FADE_MS = 500;
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const pad = (value: number) => String(value).padStart(2, '0');

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Phase = 'pre' | 'in' | 'out' | 'done';

const CenterEntrance: React.FC<{
  /** true = vừa bật giao diện → chạy lời chào. */
  play: boolean;
  person: CenterPerson;
  now?: Date;
  onDone?: () => void;
  children: React.ReactNode;
}> = ({ play, person, now = new Date(), onDone, children }) => {
  const [phase, setPhase] = useState<Phase>(() => (play && !reducedMotion() ? 'pre' : 'done'));
  const timers = useRef<number[]>([]);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setPhase('done');
    onDone?.();
  }, [onDone]);

  const leave = useCallback(() => {
    timers.current.forEach(id => window.clearTimeout(id));
    setPhase(current => (current === 'done' ? current : 'out'));
    timers.current = [window.setTimeout(finish, FADE_MS)];
  }, [finish]);

  useEffect(() => {
    if (phase !== 'pre') {
      if (phase === 'done' && play) finish();
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => setPhase('in'));
    timers.current = [window.setTimeout(leave, HOLD_MS)];
    return () => window.cancelAnimationFrame(frame);
    // Chỉ chạy lúc mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => timers.current.forEach(id => window.clearTimeout(id)), []);

  useEffect(() => {
    if (phase !== 'in' && phase !== 'pre') return undefined;
    const skip = () => leave();
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [phase, leave]);

  const showing = phase === 'pre' || phase === 'in' || phase === 'out';
  return (
    <>
      <div className="vcc-reveal" data-state={phase === 'pre' || phase === 'in' ? 'hidden' : phase === 'out' ? 'show' : undefined}>
        {children}
      </div>
      {showing && (
        <div className="vcc-intro" data-phase={phase} role="status" aria-live="polite" onClick={leave}>
          <div className="vcc-intro-inner">
            <span className="vcc-intro-mark bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-500/30">
              <PanelsTopLeft size={26} />
            </span>
            <h1 className="vcc-intro-hi"><Greeting person={person} /></h1>
            <p className="vcc-intro-sub">Chào mừng đến Trung tâm điều hành — việc của bạn, ở một nơi.</p>
            <p className="vcc-intro-date">{WEEKDAYS[now.getDay()]}, {pad(now.getDate())}/{pad(now.getMonth() + 1)}/{now.getFullYear()}</p>
          </div>
        </div>
      )}
    </>
  );
};

export default CenterEntrance;
