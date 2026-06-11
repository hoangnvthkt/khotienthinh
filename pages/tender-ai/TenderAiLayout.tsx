import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bot, Calculator, FileSpreadsheet, ShieldCheck } from 'lucide-react';

const TENDER_AI_TABS = [
  { to: '/tender-ai/boq', label: 'AI BOQ CĐT', icon: FileSpreadsheet, color: 'from-fuchsia-500 to-purple-600' },
  { to: '/tender-ai/cost-library', label: 'Dự toán nội bộ', icon: Calculator, color: 'from-rose-500 to-pink-600' },
];

const TenderAiLayout: React.FC = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-fuchsia-500/30">
            <Bot size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black">Tender AI</h1>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              Phân tích BOQ CĐT, map mẫu nội bộ, tính lại giá và kiểm soát hồ sơ chào thầu
            </p>
          </div>
          <div className="ml-auto hidden items-center gap-2 rounded-xl border border-fuchsia-100 bg-fuchsia-50 px-3 py-2 text-xs font-black text-fuchsia-700 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/30 dark:text-fuchsia-300 md:flex">
            <ShieldCheck size={14} />
            Giá vốn và margin chỉ hiển thị theo quyền
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TENDER_AI_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition-all ${
                  isActive
                    ? `bg-gradient-to-r ${tab.color} text-white shadow-md`
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
};

export default TenderAiLayout;
