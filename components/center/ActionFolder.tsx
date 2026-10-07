import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Lock, X } from 'lucide-react';
import type { WidgetView } from '../../lib/center/todayWidgets';
import type { WidgetAction } from '../../lib/center/centerActions';
import type { DrillTarget } from '../../lib/center/drill';
import { DrillLink } from './TodayView';

// "Thư mục" thao tác của một ô Hôm nay: bung ra từ đúng vị trí ô (kiểu nhóm ứng dụng iPhone) bằng
// transform + opacity (FLIP, hữu hạn, ~0,3 s), bấm ra ngoài / Esc thì thu về chỗ cũ rồi mới gỡ khỏi DOM.
// Chỉ animate transform/opacity (docs/ui/VIOO-UI-UX.md mục 6); người giảm chuyển động → mở/đóng tức thì.

const OPEN_MS = 280;
const CLOSE_MS = 240;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** transform đưa panel (đang ở vị trí cuối) về đúng khung của ô. */
const flipTransform = (panel: HTMLElement, anchor: HTMLElement): string => {
  const from = anchor.getBoundingClientRect();
  const to = panel.getBoundingClientRect();
  if (!to.width || !to.height) return 'none';
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
};

const ActionFolder: React.FC<{
  view: WidgetView;
  icon: LucideIcon;
  /** null = máy chủ chưa trả cờ quyền. */
  actions: WidgetAction[] | null;
  anchor: HTMLElement;
  onClose: () => void;
  onDrill: (target: DrillTarget) => void;
  onAction: (action: WidgetAction) => void;
}> = ({ view, icon: Icon, actions, anchor, onClose, onDrill, onAction }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closing = useRef(false);

  // Mở: đặt panel về khung của ô rồi thả về vị trí thật.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (reducedMotion()) { setOpen(true); return; }
    panel.style.transition = 'none';
    panel.style.transform = flipTransform(panel, anchor);
    panel.style.opacity = '0.35';
    void panel.offsetWidth;
    const frame = requestAnimationFrame(() => {
      panel.style.transition = '';
      panel.style.transform = '';
      panel.style.opacity = '';
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { previous?.focus?.({ preventScroll: true }); };
  }, []);

  // Đóng: thu về khung của ô (ô có thể đã cuộn nên đo lại) rồi mới gỡ.
  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const panel = panelRef.current;
    setOpen(false);
    if (!panel || reducedMotion() || !anchor.isConnected) { onClose(); return; }
    panel.style.transform = flipTransform(panel, anchor);
    panel.style.opacity = '0.2';
    const timer = window.setTimeout(onClose, CLOSE_MS + 60);
    panel.addEventListener('transitionend', event => {
      if (event.target === panel && event.propertyName === 'transform') { window.clearTimeout(timer); onClose(); }
    }, { once: true });
  }, [anchor, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); requestClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const run = (fn: () => void) => { fn(); requestClose(); };
  const enabledCount = actions?.filter(action => action.enabled).length ?? 0;

  return (
    <div className="vcc-fold-layer" data-open={open}>
      <div className="vcc-fold-backdrop" data-open={open} onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`vcc-fold vcc-mod-${view.module}`}
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`vcc-fold-${view.id}`}
        tabIndex={-1}
        style={{ ['--vcc-fold-ms' as string]: `${OPEN_MS}ms` }}
      >
        <header className="vcc-fold-head">
          <span className="vcc-wicon"><Icon size={16} /></span>
          <div className="min-w-0 flex-1">
            <h2 id={`vcc-fold-${view.id}`} className="vcc-fold-title vcc-ellipsis">{view.title}</h2>
            <div className="text-xs vcc-muted vcc-ellipsis">{view.sub}</div>
          </div>
          <button type="button" className="vcc-iconbtn" onClick={requestClose} aria-label="Đóng"><X size={15} /></button>
        </header>
        <div className="vcc-fold-body">
          {view.empty ? (
            <p className="m-0 text-[12.5px] vcc-muted">{view.empty.text}</p>
          ) : (
            <div className="vcc-fold-stats">
              {view.stats.map(stat => (
                <div key={stat.key} className="vcc-stat" data-stat={stat.key}>
                  <span className="vcc-stat-k">{stat.label}</span>
                  <span className="vcc-stat-val">
                    <DrillLink stat={stat} onDrill={target => run(() => onDrill(target))} />
                    {stat.hint && <span className="vcc-stat-hint">{stat.hint}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="vcc-fold-section">
            <span>Thao tác</span>
            {actions && <span className="vcc-muted"> · {enabledCount}/{actions.length} theo quyền của bạn</span>}
          </div>
          {actions === null ? (
            <p className="m-0 text-[12.5px] vcc-muted">Đang kiểm tra quyền…</p>
          ) : (
            <div className="vcc-fold-acts" role="group" aria-label={`Thao tác ${view.title}`}>
              {actions.map(action => (
                <button
                  key={action.key}
                  type="button"
                  className="vcc-act"
                  data-pri={action.primary && action.enabled ? 'true' : undefined}
                  disabled={!action.enabled}
                  title={action.enabled ? `Mở ${action.target.title}` : action.lockReason}
                  onClick={() => run(() => onAction(action))}
                >
                  {!action.enabled && <Lock size={12} />}
                  <span className="vcc-ellipsis">{action.label}</span>
                  {action.enabled && <ArrowUpRight size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <footer className="vcc-fold-foot">
          <span className="text-xs vcc-muted">Bấm ra ngoài hoặc Esc để thu lại.</span>
          <button type="button" className="vcc-link" onClick={() => run(() => onDrill({ kind: 'route', path: view.route, title: view.routeLabel }))}>
            {view.routeLabel} <ArrowUpRight size={13} />
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ActionFolder;
