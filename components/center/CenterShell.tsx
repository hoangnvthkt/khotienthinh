import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, LayoutDashboard, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sparkles, Sun } from 'lucide-react';
import InboxPanel, { workItemKey, type LoadWorkItems } from './InboxPanel';
import WorkTabs, { type CenterWorkTab } from './WorkTabs';
import TodayView, { type CenterPerson } from './TodayView';
import WorkItemTab, { type RendererComponent } from './WorkItemTab';
import { resolveDrillTarget, type DrillTarget } from '../../lib/center/drill';
import type { WorkItem } from '../../lib/center/workItemsService';
import './center.css';

type MobilePane = 'inbox' | 'today' | 'assistant';

const INBOX_HIDDEN_KEY = 'vcc_inbox_hidden';
const INBOX_WIDTH_KEY = 'vcc_inbox_w';
const INBOX_MIN = 260;
const INBOX_MAX = 460;
const readStorage = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStorage = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* chỉ là tiện ích */ } };
const clampWidth = (value: number) => Math.min(INBOX_MAX, Math.max(INBOX_MIN, value));

const TODAY_TAB: CenterWorkTab = { id: 'today', title: 'Hôm nay', closable: false };

interface OpenTab extends CenterWorkTab { item: WorkItem; target: DrillTarget }

// View thật của module tải lười: chỉ khi mở hồ sơ đầu tiên.
const LazyRenderer: RendererComponent = React.lazy(() => import('./CenterRenderers'));

const wordsOf = (name: string) => name.trim().split(/\s+/).filter(word => /\p{L}/u.test(word));
/** Người: chữ đầu của họ và tên ("Phạm Ngọc Sơn" → PS). */
const personInitials = (name: string) => {
  const words = wordsOf(name);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?';
};
/** Công ty: như header điện thoại của app — chữ đầu của hai từ đầu. */
const companyInitials = (name: string) => wordsOf(name).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'V';

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
  /** View nhúng cho tab hồ sơ (mặc định tải lười CenterRenderers). */
  Renderer?: RendererComponent;
}

// Khung 3 vùng theo mockup v1.1: Việc của tôi · vùng làm việc có tab · Trợ lý (thu gọn).
// Rail module bên trái là Sidebar sẵn có của Layout.
const CenterShell: React.FC<CenterShellProps> = ({
  person, company, isDark, onToggleTheme, onOpenMenu, mobileNotifications, canOpenRoute, onNavigate, now = new Date(),
  loadWorkItems, Renderer = LazyRenderer,
}) => {
  const [mobilePane, setMobilePane] = useState<MobilePane>('inbox');
  const [inboxHidden, setInboxHidden] = useState(() => readStorage(INBOX_HIDDEN_KEY) === 'true');
  const [inboxWidth, setInboxWidth] = useState(() => clampWidth(Number(readStorage(INBOX_WIDTH_KEY)) || 340));
  const [resizing, setResizing] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState(TODAY_TAB.id);
  const [mineCount, setMineCount] = useState<number | null>(null);
  const workBody = useRef<HTMLDivElement>(null);

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

  const openItem = useCallback((item: WorkItem) => {
    const id = workItemKey(item);
    setOpenTabs(current => current.some(tab => tab.id === id)
      ? current
      : [...current, { id, title: item.code, closable: true, item, target: resolveDrillTarget(item) }]);
    setActiveTab(id);
    setMobilePane('today');
  }, []);

  const closeTab = (id: string) => {
    setOpenTabs(current => {
      const index = current.findIndex(tab => tab.id === id);
      const next = current.filter(tab => tab.id !== id);
      if (activeTab === id) setActiveTab(index > 0 ? next[index - 1].id : TODAY_TAB.id);
      return next;
    });
  };

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
          activeItemKey={current?.id || null}
          onOpen={openItem}
          onMineCount={onMineCount}
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
                target={current.target}
                now={now}
                onNavigate={onNavigate}
                onBack={() => setMobilePane('inbox')}
                Renderer={Renderer}
              />
            ) : (
              <TodayView person={person} now={now} canOpenRoute={canOpenRoute} onNavigate={onNavigate} />
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
