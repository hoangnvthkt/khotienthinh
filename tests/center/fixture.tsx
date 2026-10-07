// Dữ liệu minh họa, chỉ dùng cho kiểm thử giao diện. Không gọi Supabase.
// ?theme=dark để xem nền tối. Cột 64px bên trái chỉ giả lập thanh bên (Sidebar) có sẵn của app.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Bell, Briefcase, FileText, LayoutDashboard, Package, PanelsTopLeft, ShoppingCart, Wallet } from 'lucide-react';
import CenterShell from '../../components/center/CenterShell';
import '../../index.css';

const params = new URLSearchParams(location.search);
const DENIED_ROUTES = new Set(['/procurement']);

const FakeRail: React.FC = () => (
  <nav className="hidden lg:flex w-16 flex-none flex-col items-center gap-2 border-r border-slate-200 bg-white/70 py-4 text-slate-500 dark:border-slate-800 dark:bg-[#1c1f22]" aria-label="Thanh bên của app">
    <span className="mb-2 grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-[11px] font-bold text-white">TT</span>
    {[PanelsTopLeft, LayoutDashboard, BarChart3, Briefcase, ShoppingCart, Package, Wallet, FileText].map((Icon, index) => (
      <span key={index} className={`grid h-10 w-10 place-items-center rounded-xl ${index === 0 ? 'bg-teal-700 text-white' : ''}`}><Icon size={18} /></span>
    ))}
  </nav>
);

const Fixture: React.FC = () => {
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [lastRoute, setLastRoute] = useState('');
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden" data-last-route={lastRoute}>
      <FakeRail />
      <main className="min-w-0 flex-1">
        <CenterShell
          person={{ fullName: 'Phạm Ngọc Sơn', gender: 'Nam', title: 'Chỉ huy trưởng · SMB-2026' }}
          company={{ name: 'Tiến Thịnh' }}
          isDark={dark}
          onToggleTheme={() => setDark(value => !value)}
          onOpenMenu={() => setLastRoute('menu')}
          mobileNotifications={<button type="button" className="vcc-iconbtn" aria-label="Thông báo"><Bell size={15} /></button>}
          canOpenRoute={route => !DENIED_ROUTES.has(route)}
          onNavigate={setLastRoute}
          now={new Date(2026, 9, 7, 8, 30)}
        />
      </main>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Fixture />);
