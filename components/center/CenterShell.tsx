import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, LayoutDashboard, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sparkles, Sun } from 'lucide-react';
import InboxPanel, { workItemKey, type LoadWorkItems } from './InboxPanel';
import WorkTabs, { type CenterWorkTab } from './WorkTabs';
import TodayView, { WIDGET_ICONS, type CenterPerson, type TodayState } from './TodayView';
import ActionFolder from './ActionFolder';
import WorkItemTab, { type RendererComponent } from './WorkItemTab';
import { resolveDrillTarget, type DrillTarget, type ItemDrillTarget } from '../../lib/center/drill';
import type { CenterModuleKey, CenterWidgetId } from '../../lib/center/centerRegistry';
import { buildWidgetActions, fetchCenterActions, type CenterActionFlags, type CenterModal, type WidgetAction } from '../../lib/center/centerActions';
import type { WidgetView } from '../../lib/center/todayWidgets';
import type { WorkItem } from '../../lib/center/workItemsService';
import { fetchCenterToday, fetchSiteWeather, type CenterToday, type SiteWeather } from '../../lib/center/centerTodayService';
import type { WeatherSlot } from '../../lib/center/todayWidgets';
import './center.css';

type MobilePane = 'inbox' | 'today' | 'assistant';

const INBOX_HIDDEN_KEY = 'vcc_inbox_hidden';
const INBOX_WIDTH_KEY = 'vcc_inbox_w';
const PROJECT_KEY = 'vcc_project';
const INBOX_MIN = 260;
const INBOX_MAX = 460;
const FOCUS_REFRESH_MS = 60_000;
const readStorage = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStorage = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* chỉ là tiện ích */ } };
const clampWidth = (value: number) => Math.min(INBOX_MAX, Math.max(INBOX_MIN, value));

const TODAY_TAB: CenterWorkTab = { id: 'today', title: 'Hôm nay', closable: false };

interface OpenTab extends CenterWorkTab { item: WorkItem | null; module: CenterModuleKey; target: ItemDrillTarget }

// View thật của module tải lười: chỉ khi mở hồ sơ đầu tiên. Form modal (đề xuất, nghỉ phép) cũng tải lười.
const LazyRenderer: RendererComponent = React.lazy(() => import('./CenterRenderers'));
export type ModalHostComponent = React.ComponentType<{ modal: CenterModal; onClose: () => void; onDone: () => void }>;
const LazyModalHost: ModalHostComponent = React.lazy(() => import('./CenterModals'));

const wordsOf = (name: string) => name.trim().split(/\s+/).filter(word => /\p{L}/u.test(word));
/** Người: chữ đầu của họ và tên ("Phạm Ngọc Sơn" → PS). */
const personInitials = (name: string) => {
  const words = wordsOf(name);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?';
};
/** Công ty: như header điện thoại của app — chữ đầu của hai từ đầu. */
const companyInitials = (name: string) => wordsOf(name).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'V';

export type LoadToday = (projectId: string | null) => Promise<CenterToday>;
export type LoadWeather = (site: { id: string; latitude: number; longitude: number }, now: Date) => Promise<SiteWeather | null>;
export type LoadActions = (projectId: string | null) => Promise<CenterActionFlags>;

export interface CenterShellProps {
  person: CenterPerson & { title?: string | null; avatar?: string | null };
  company: { name: string; logo?: string | null };
  isDark: boolean;
  onToggleTheme: () => void;
  /** Điện thoại: mở menu ứng dụng (Sidebar của Layout). */
  onOpenMenu?: () => void;
  /** Chuông thông báo cho điện thoại; trên máy tính chuông nằm ở thanh bên trái. */
  mobileNotifications?: React.ReactNode;
  canOpenRoute: (route: string) => boolean;
  onNavigate: (route: string) => void;
  now?: Date;
  /** Nguồn việc (mặc định RPC vcc_my_work_items_v1); fixture kiểm thử truyền dữ liệu mẫu. */
  loadWorkItems?: LoadWorkItems;
  /** Số liệu Hôm nay (mặc định RPC vcc_my_center_v1). */
  loadToday?: LoadToday;
  /** Thời tiết công trường (mặc định Open-Meteo, cache 30 phút). */
  loadWeather?: LoadWeather;
  /** Cờ "được bấm gì" cho thao tác nhanh (mặc định RPC vcc_my_actions_v1). */
  loadActions?: LoadActions;
  /** View nhúng cho tab hồ sơ (mặc định tải lười CenterRenderers). */
  Renderer?: RendererComponent;
  /** Form modal thật của module (mặc định tải lười CenterModals). */
  ModalHost?: ModalHostComponent;
}

// Khung 3 vùng theo mockup v1.1: Việc của tôi · vùng làm việc có tab · Trợ lý (thu gọn).
// Rail module bên trái là Sidebar sẵn có của Layout.
const CenterShell: React.FC<CenterShellProps> = ({
  person, company, isDark, onToggleTheme, onOpenMenu, mobileNotifications, canOpenRoute, onNavigate, now = new Date(),
  loadWorkItems, loadToday = fetchCenterToday, loadWeather = (site, at) => fetchSiteWeather(site.id, site.latitude, site.longitude, at),
  loadActions = fetchCenterActions, Renderer = LazyRenderer, ModalHost = LazyModalHost,
}) => {
  const [mobilePane, setMobilePane] = useState<MobilePane>('inbox');
  const [inboxHidden, setInboxHidden] = useState(() => readStorage(INBOX_HIDDEN_KEY) === 'true');
  const [inboxWidth, setInboxWidth] = useState(() => clampWidth(Number(readStorage(INBOX_WIDTH_KEY)) || 340));
  const [resizing, setResizing] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState(TODAY_TAB.id);
  const [mineCount, setMineCount] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() => readStorage(PROJECT_KEY));
  const [today, setToday] = useState<TodayState>({ status: 'loading' });
  const [weather, setWeather] = useState<WeatherSlot>(null);
  const [todayAttempt, setTodayAttempt] = useState(0);
  const [actionFlags, setActionFlags] = useState<CenterActionFlags | null>(null);
  const [folder, setFolder] = useState<{ view: WidgetView; anchor: HTMLElement } | null>(null);
  const [modal, setModal] = useState<CenterModal | null>(null);
  const [inboxRefresh, setInboxRefresh] = useState(0);
  const workBody = useRef<HTMLDivElement>(null);
  const todaySeq = useRef(0);
  const lastFocusRefresh = useRef(0);

  // Số liệu Hôm nay: tải theo dự án đang chọn; làm mới khi quay lại cửa sổ (≤ 1 lần/phút).
  useEffect(() => {
    const seq = ++todaySeq.current;
    setToday(current => (current.status === 'ready' ? current : { status: 'loading' }));
    loadToday(projectId).then(data => {
      if (todaySeq.current !== seq) return;
      setToday({ status: 'ready', data });
      // Cờ thao tác theo dự án máy chủ đã chọn (có thể khác projectId đã lưu).
      loadActions(data.project?.id || null)
        .then(flags => { if (todaySeq.current === seq) setActionFlags(flags); })
        .catch(error => { console.warn('Center actions failed:', error); if (todaySeq.current === seq) setActionFlags(null); });
    }).catch(error => {
      if (todaySeq.current !== seq) return;
      console.warn('Center today failed:', error);
      setToday({ status: 'error', message: 'Kiểm tra mạng rồi thử lại. Việc của tôi và các module vẫn dùng bình thường.' });
    });
  }, [loadToday, loadActions, projectId, todayAttempt]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const at = Date.now();
      if (at - lastFocusRefresh.current < FOCUS_REFRESH_MS) return;
      lastFocusRefresh.current = at;
      setTodayAttempt(value => value + 1);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  // Thời tiết công trường của dự án đang xem; không có tọa độ hoặc lỗi → ẩn, không báo đỏ.
  const site = today.status === 'ready' ? today.data.project?.site : null;
  const siteKey = site && site.latitude != null && site.longitude != null ? `${site.id}:${site.latitude}:${site.longitude}` : null;
  useEffect(() => {
    if (!siteKey || !site || site.latitude == null || site.longitude == null) { setWeather(null); return; }
    let alive = true;
    setWeather('loading');
    loadWeather({ id: site.id, latitude: site.latitude, longitude: site.longitude }, now)
      .then(result => { if (alive) setWeather(result); })
      .catch(() => { if (alive) setWeather(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, loadWeather]);

  const toggleInbox = () => setInboxHidden(value => { writeStorage(INBOX_HIDDEN_KEY, String(!value)); return !value; });

  // Kéo mép cột việc (260–460px), nhớ độ rộng trên trình duyệt này.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = inboxWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setResizing(true);
    const move = (ev: PointerEvent) => setInboxWidth(clampWidth(startWidth + ev.clientX - startX));
    const stop = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
      setResizing(false);
      setInboxWidth(width => { writeStorage(INBOX_WIDTH_KEY, String(width)); return width; });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
  };

  const openTab = useCallback((tab: OpenTab) => {
    setOpenTabs(current => current.some(existing => existing.id === tab.id) ? current : [...current, tab]);
    setActiveTab(tab.id);
    setMobilePane('today');
  }, []);

  const openItem = useCallback((item: WorkItem) => {
    openTab({ id: workItemKey(item), title: item.code, closable: true, item, module: item.module, target: resolveDrillTarget(item) });
  }, [openTab]);

  // Đích từ widget: route → sang module; tab → mở view nhúng; inbox → về cột việc.
  const onDrill = useCallback((target: DrillTarget) => {
    if (target.kind === 'route') { onNavigate(target.path); return; }
    if (target.kind === 'inbox') { setInboxHidden(false); writeStorage(INBOX_HIDDEN_KEY, 'false'); setMobilePane('inbox'); return; }
    const module: CenterModuleKey = target.renderer === 'request' ? 'request' : target.renderer === 'finance' ? 'finance'
      : target.renderer === 'site_assignment' ? 'hrm' : 'procurement';
    openTab({ id: `drill:${target.renderer}:${JSON.stringify(target.props)}`, title: target.title, closable: true, item: null, module, target });
  }, [onNavigate, openTab]);

  const closeTab = (id: string) => {
    setOpenTabs(current => {
      const index = current.findIndex(tab => tab.id === id);
      const next = current.filter(tab => tab.id !== id);
      if (activeTab === id) setActiveTab(index > 0 ? next[index - 1].id : TODAY_TAB.id);
      return next;
    });
  };

  const selectProject = (id: string) => { writeStorage(PROJECT_KEY, id); setProjectId(id); };

  // Thao tác nhanh: nút theo cờ máy chủ; mở form modal thật hoặc đích drill-down.
  const todayProject = today.status === 'ready' ? today.data.project : null;
  const actionsFor = useCallback((id: CenterWidgetId): WidgetAction[] | null =>
    actionFlags ? buildWidgetActions(id, actionFlags, todayProject, now) : null, [actionFlags, todayProject, now]);
  const onOpenFolder = useCallback((view: WidgetView, anchor: HTMLElement) => setFolder({ view, anchor }), []);
  const onAction = useCallback((action: WidgetAction) => {
    if (action.target.kind === 'modal') setModal(action.target.modal); else onDrill(action.target);
  }, [onDrill]);
  const onModalDone = useCallback(() => { setInboxRefresh(value => value + 1); setTodayAttempt(value => value + 1); }, []);

  useEffect(() => { workBody.current?.scrollTo({ top: 0 }); }, [activeTab]);

  const tabs: readonly CenterWorkTab[] = [TODAY_TAB, ...openTabs];
  const current = openTabs.find(tab => tab.id === activeTab);
  const onMineCount = useCallback((count: number | null) => setMineCount(count), []);

  return (
    <div className="vcc" data-pane={mobilePane}>
      <header className="vcc-top">
        {onOpenMenu && (
          <button type="button" className="vcc-iconbtn vcc-mobile-only" onClick={onOpenMenu} aria-label="Mở menu ứng dụng">
            <Menu size={16} />
          </button>
        )}
        <button
          type="button"
          className="vcc-iconbtn vcc-desktop-only"
          onClick={toggleInbox}
          aria-pressed={!inboxHidden}
          title={inboxHidden ? 'Hiện Việc của tôi' : 'Ẩn Việc của tôi'}
          aria-label={inboxHidden ? 'Hiện Việc của tôi' : 'Ẩn Việc của tôi'}
        >
          {inboxHidden ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="vcc-brand">
          <div className="vcc-logo" aria-hidden="true">
            {company.logo ? <img src={company.logo} alt="" /> : companyInitials(company.name)}
          </div>
          <div className="min-w-0">
            <div className="vcc-title vcc-ellipsis">Trung tâm điều hành</div>
            <div className="text-xs vcc-muted vcc-ellipsis">{company.name}</div>
          </div>
        </div>
        <button type="button" className="vcc-iconbtn" onClick={onToggleTheme} aria-label={isDark ? 'Chuyển nền sáng' : 'Chuyển nền tối'} title={isDark ? 'Nền sáng' : 'Nền tối'}>
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button type="button" className="vcc-iconbtn vcc-desktop-only" onClick={() => setAssistantOpen(open => !open)} aria-pressed={assistantOpen}>
          <Sparkles size={15} /> Trợ lý
        </button>
        {mobileNotifications && <div className="vcc-mobile-only flex">{mobileNotifications}</div>}
        <div className="vcc-user">
          <div className="vcc-desktop-only min-w-0 text-right leading-tight">
            <div className="vcc-who vcc-ellipsis max-w-[200px]">{person.fullName}</div>
            {person.title && <div className="text-xs vcc-muted vcc-ellipsis max-w-[200px]">{person.title}</div>}
          </div>
          <div className="vcc-avatar" title={person.fullName}>
            {person.avatar ? <img src={person.avatar} alt="" /> : personInitials(person.fullName)}
          </div>
        </div>
      </header>

      <div className="vcc-body" style={{ ['--vcc-inbox-w' as string]: `${inboxWidth}px` }}>
        <InboxPanel
          hidden={inboxHidden}
          load={loadWorkItems}
          now={now}
          activeItemKey={current?.item ? current.id : null}
          onOpen={openItem}
          onMineCount={onMineCount}
          refreshToken={inboxRefresh}
          resizer={(
            <div
              className="vcc-resizer vcc-desktop-only"
              data-active={resizing || undefined}
              onPointerDown={startResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Kéo để đổi độ rộng Việc của tôi"
            />
          )}
        />
        <section className="vcc-work" aria-label="Vùng làm việc">
          <WorkTabs tabs={tabs} activeId={activeTab} onSelect={setActiveTab} onClose={closeTab} />
          <div className="vcc-scroll" ref={workBody}>
            {current ? (
              <WorkItemTab
                key={current.id}
                item={current.item}
                title={current.title}
                module={current.module}
                target={current.target}
                now={now}
                onNavigate={onNavigate}
                onBack={() => setMobilePane('inbox')}
                Renderer={Renderer}
              />
            ) : (
              <TodayView
                person={person}
                now={now}
                canOpenRoute={canOpenRoute}
                onNavigate={onNavigate}
                onDrill={onDrill}
                onOpenFolder={onOpenFolder}
                actionsFor={actionsFor}
                today={today}
                weather={weather}
                mineCount={mineCount}
                onSelectProject={selectProject}
                onRetry={() => setTodayAttempt(value => value + 1)}
              />
            )}
          </div>
        </section>
        <aside className="vcc-ai" data-open={assistantOpen} aria-label="Trợ lý Vioo">
          <div className="flex items-center gap-2 border-b border-[color:var(--vcc-border)] px-4 py-2.5">
            <b>Trợ lý Vioo</b>
            <span className="vcc-badge">Sắp có</span>
            <button type="button" className="vcc-desktop-only ml-auto text-xs vcc-muted" onClick={() => setAssistantOpen(false)}>Đóng</button>
          </div>
          <div className="space-y-3 p-4">
            <p className="m-0">Trợ lý sẽ giúp tra số, điền sẵn phiếu và mở bản tóm tắt trước khi bạn bấm.</p>
            <p className="m-0 text-xs vcc-muted">Nút Gửi, Duyệt luôn do bạn bấm. Trợ lý đang được chuẩn bị, chưa dùng được.</p>
          </div>
        </aside>
      </div>

      {folder && (
        <ActionFolder
          key={folder.view.id}
          view={folder.view}
          icon={WIDGET_ICONS[folder.view.id]}
          actions={actionsFor(folder.view.id)}
          anchor={folder.anchor}
          onClose={() => setFolder(null)}
          onDrill={onDrill}
          onAction={onAction}
        />
      )}
      {modal && (
        <React.Suspense fallback={null}>
          <ModalHost modal={modal} onClose={() => setModal(null)} onDone={onModalDone} />
        </React.Suspense>
      )}

      <nav className="vcc-mnav" role="tablist" aria-label="Chọn vùng">
        <button type="button" role="tab" aria-selected={mobilePane === 'inbox'} onClick={() => setMobilePane('inbox')}>
          <Inbox size={18} /> Việc{mineCount ? ` ${mineCount}` : ''}
        </button>
        <button type="button" role="tab" aria-selected={mobilePane === 'today'} onClick={() => setMobilePane('today')}>
          <LayoutDashboard size={18} /> {current ? 'Hồ sơ' : 'Hôm nay'}
        </button>
        <button type="button" role="tab" aria-selected={mobilePane === 'assistant'} onClick={() => setMobilePane('assistant')}>
          <Sparkles size={18} /> Trợ lý
        </button>
      </nav>
    </div>
  );
};

export default CenterShell;
