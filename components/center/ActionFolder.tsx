import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Check, Lock, Pin, X } from 'lucide-react';
import type { WidgetView } from '../../lib/center/todayWidgets';
import type { WidgetAction } from '../../lib/center/centerActions';
import type { DrillTarget } from '../../lib/center/drill';
import { AppIcon, QuickAction, actionStyle } from './TodayView';
import { MAX_PINNED_ACTIONS } from '../../lib/center/centerLayout';

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
  /** Tăng để yêu cầu thu lại từ bên ngoài (nút Back). */
  closeRequest?: number;
  /** Nút đang hiện trên ô (đã chọn hoặc mặc định). */
  shownKeys: string[];
  /** Chọn nút trên ô: null = được chọn; chuỗi = lý do khóa. */
  pinLock: string | null;
  onSavePinned: (keys: string[]) => Promise<void>;
}> = ({ view, icon: Icon, actions, anchor, onClose, onDrill, onAction, closeRequest = 0, shownKeys, pinLock, onSavePinned }) => {
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

  const initialCloseRequest = useRef(closeRequest);
  useEffect(() => {
    if (closeRequest !== initialCloseRequest.current) requestClose();
  }, [closeRequest, requestClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); requestClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const run = (fn: () => void) => { fn(); requestClose(); };
  const enabledCount = actions?.filter(action => action.enabled).length ?? 0;

  // Chọn nút hiện trên ô (tối đa 4), lưu cho tài khoản.
  const [picking, setPicking] = useState<string[] | null>(null);
  const [pinStatus, setPinStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const togglePick = (key: string) => setPicking(current => {
    if (!current) return current;
    if (current.includes(key)) return current.filter(item => item !== key);
    return current.length >= MAX_PINNED_ACTIONS ? current : [...current, key];
  });
  const savePick = () => {
    if (!picking) return;
    setPinStatus('saving');
    onSavePinned(picking).then(() => { setPicking(null); setPinStatus('idle'); }).catch(error => {
      console.warn('Center pinned actions save failed:', error);
      setPinStatus('error');
    });
  };

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
          {actions && !picking && (
            <button
              type="button"
              className="vcc-iconbtn"
              onClick={() => { setPicking(shownKeys); setPinStatus('idle'); }}
              disabled={!!pinLock}
              title={pinLock || `Chọn tối đa ${MAX_PINNED_ACTIONS} nút hiện trên ô`}
            >
              {pinLock ? <Lock size={13} /> : <Pin size={13} />} <span className="text-xs">Chọn nút trên ô</span>
            </button>
          )}
          <button type="button" className="vcc-iconbtn" onClick={requestClose} aria-label="Đóng"><X size={15} /></button>
        </header>
        <div className="vcc-fold-body">
          {view.empty && <p className="mt-0 mb-3 text-[12.5px] vcc-muted">{view.empty.text}</p>}
          {actions === null ? (
            <p className="m-0 text-[12.5px] vcc-muted">Đang kiểm tra quyền…</p>
          ) : (
            <>
              {picking ? (
                <>
                  <div className="vcc-fold-section">Chọn nút hiện trên ô · đã chọn {picking.length}/{MAX_PINNED_ACTIONS}</div>
                  <div className="vcc-fold-acts" role="group" aria-label={`Chọn nút trên ô ${view.title}`}>
                    {actions.map(action => {
                      const on = picking.includes(action.key);
                      const full = !on && picking.length >= MAX_PINNED_ACTIONS;
                      return (
                        <button
                          key={action.key}
                          type="button"
                          className="vcc-act"
                          data-picking="true"
                          aria-pressed={on}
                          disabled={!action.enabled || full}
                          title={!action.enabled ? action.lockReason : full ? `Đã đủ ${MAX_PINNED_ACTIONS} nút — bỏ bớt một nút trước` : undefined}
                          onClick={() => togglePick(action.key)}
                        >
                          <AppIcon style={actionStyle(action)} size="row" />
                          <span className="vcc-act-text"><span className="vcc-ellipsis">{action.label}</span></span>
                          <span className="vcc-pick" aria-hidden="true">{on && <Check size={13} />}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="vcc-fold-section">{enabledCount}/{actions.length} thao tác theo quyền của bạn</div>
                  <div className="vcc-fold-acts" role="group" aria-label={`Thao tác ${view.title}`}>
                    {actions.map(action => (
                      <QuickAction key={action.key} action={action} variant="row" onAction={picked => run(() => onAction(picked))} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        {picking ? (
          <footer className="vcc-fold-foot">
            {pinStatus === 'error'
              ? <span className="text-xs vcc-danger-text" role="alert">Chưa lưu được — thử lại</span>
              : <span className="text-xs vcc-muted">Nút hiện trên ô theo thứ tự bạn chọn.</span>}
            <span className="flex gap-2">
              <button type="button" className="vcc-btn" onClick={() => setPicking(null)} disabled={pinStatus === 'saving'}>Hủy</button>
              <button type="button" className="vcc-btn" data-pri="true" onClick={savePick} disabled={pinStatus === 'saving'}>
                {pinStatus === 'saving' ? 'Đang lưu…' : 'Lưu'}
              </button>
            </span>
          </footer>
        ) : (
          <footer className="vcc-fold-foot">
            <span className="text-xs vcc-muted">Bấm ra ngoài hoặc Esc để thu lại.</span>
            <button type="button" className="vcc-link" onClick={() => run(() => onDrill({ kind: 'route', path: view.route, title: view.routeLabel }))}>
              {view.routeLabel} <ArrowUpRight size={13} />
            </button>
          </footer>
        )}
      </div>
    </div>
  );
};

export default ActionFolder;
