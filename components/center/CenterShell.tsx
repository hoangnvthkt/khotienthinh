import React, { useState } from 'react';
import { Inbox, LayoutDashboard, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sparkles, Sun } from 'lucide-react';
import InboxPanel from './InboxPanel';
import WorkTabs, { type CenterWorkTab } from './WorkTabs';
import TodayView, { type CenterPerson } from './TodayView';
import './center.css';

type MobilePane = 'inbox' | 'today' | 'assistant';

const INBOX_HIDDEN_KEY = 'vcc_inbox_hidden';
const readInboxHidden = () => {
  try { return localStorage.getItem(INBOX_HIDDEN_KEY) === 'true'; } catch { return false; }
};

const TODAY_TAB: CenterWorkTab = { id: 'today', title: 'Hôm nay', closable: false };
// PR-B/PR-D thêm tab hồ sơ / thao tác (có ✕) vào danh sách này.
const TABS: readonly CenterWorkTab[] = [TODAY_TAB];

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
}

// Khung 3 vùng theo mockup v1.1: Việc của tôi · vùng làm việc có tab · Trợ lý (thu gọn).
// Rail module bên trái là Sidebar sẵn có của Layout.
const CenterShell: React.FC<CenterShellProps> = ({
  person, company, isDark, onToggleTheme, onOpenMenu, mobileNotifications, canOpenRoute, onNavigate, now = new Date(),
}) => {
  const [mobilePane, setMobilePane] = useState<MobilePane>('inbox');
  const [inboxHidden, setInboxHidden] = useState(readInboxHidden);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(TODAY_TAB.id);

  const toggleInbox = () => setInboxHidden(value => {
    try { localStorage.setItem(INBOX_HIDDEN_KEY, String(!value)); } catch { /* chỉ là tiện ích, bỏ qua */ }
    return !value;
  });

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

      <div className="vcc-body">
        <InboxPanel hidden={inboxHidden} onOpenHome={() => onNavigate('/')} />
        <section className="vcc-work" aria-label="Vùng làm việc">
          <WorkTabs tabs={TABS} activeId={activeTab} onSelect={setActiveTab} onClose={() => setActiveTab(TODAY_TAB.id)} />
          <div className="vcc-scroll">
            {activeTab === TODAY_TAB.id && <TodayView person={person} now={now} canOpenRoute={canOpenRoute} onNavigate={onNavigate} />}
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
          <Inbox size={18} /> Việc
        </button>
        <button type="button" role="tab" aria-selected={mobilePane === 'today'} onClick={() => setMobilePane('today')}>
          <LayoutDashboard size={18} /> Hôm nay
        </button>
        <button type="button" role="tab" aria-selected={mobilePane === 'assistant'} onClick={() => setMobilePane('assistant')}>
          <Sparkles size={18} /> Trợ lý
        </button>
      </nav>
    </div>
  );
};

export default CenterShell;
