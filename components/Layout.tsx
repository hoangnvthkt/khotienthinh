
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { RefreshCw, Menu, AlertTriangle, ExternalLink, Bell, X, Moon, Sun, Package } from 'lucide-react';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 phút
const WARN_BEFORE_MS = 5 * 60 * 1000; // Cảnh báo 5 phút trước

const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [sessionWarning, setSessionWarning] = useState(false);
  const [countdown, setCountdown] = useState(300); // 5 minutes in seconds

  const { isRefreshing, appSettings, isLoading, connectionError, logout, items } = useApp();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const lastActivityRef = useRef<number>(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();

  const appInitials = appSettings.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

  // Low stock notifications
  const lowStockItems = useMemo(() => {
    return items.filter(item => {
      const totalStock = Object.values(item.stockByWarehouse).reduce((a: number, b) => a + (b as number), 0);
      return totalStock <= item.minStock;
    }).slice(0, 10);
  }, [items]);

  // Session timeout logic
  const resetTimers = () => {
    lastActivityRef.current = Date.now();
    setSessionWarning(false);
    clearTimeout(warningTimerRef.current);
    clearTimeout(logoutTimerRef.current);
    clearInterval(countdownRef.current);

    warningTimerRef.current = setTimeout(() => {
      setSessionWarning(true);
      setCountdown(300);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            logout();
            navigate('/login');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, SESSION_TIMEOUT_MS - WARN_BEFORE_MS);

    logoutTimerRef.current = setTimeout(() => {
      logout();
      navigate('/login');
    }, SESSION_TIMEOUT_MS);
  };

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    const handleActivity = () => {
      if (!sessionWarning) resetTimers();
    };
    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));
    resetTimers();
    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      clearTimeout(warningTimerRef.current);
      clearTimeout(logoutTimerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [sessionWarning]);

  if (connectionError) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white rounded-3xl shadow-2xl border border-red-100 p-8 max-w-lg w-full text-center space-y-6">
          <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border-4 border-red-100">
            <AlertTriangle size={40} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-800">Lỗi kết nối hệ thống</h2>
            <p className="text-slate-500 text-sm leading-relaxed">{connectionError}</p>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl text-left border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cách khắc phục:</p>
            <ul className="text-xs text-slate-600 space-y-2 font-medium">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0"></span>
                Kiểm tra và dán API Key thực tế vào file <code>lib/supabase.ts</code>.
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0"></span>
                Đảm bảo Supabase Project đã được cấu hình đúng URL và Anon Key.
              </li>
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              className="w-full py-3 bg-slate-800 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-slate-700 transition flex items-center justify-center gap-2"
            >
              Mở Supabase Dashboard <ExternalLink size={14} />
            </a>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-slate-50 transition"
            >
              Thử tải lại trang
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen overflow-hidden relative ${isDark ? 'dark bg-slate-900' : 'bg-slate-50'}`}>
      {/* Session Warning Modal */}
      {sessionWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-amber-200 p-8 max-w-sm w-full mx-4 text-center">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="text-amber-500" size={32} />
            </div>
            <h2 className="text-xl font-black text-slate-800 dark:text-white mb-2">Phiên sắp hết hạn</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
              Hệ thống sẽ tự đăng xuất sau{' '}
              <span className="font-black text-amber-600 text-lg">
                {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
              </span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={resetTimers}
                className="flex-1 py-3 bg-accent text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition"
              >
                Tiếp tục làm việc
              </button>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      )}

      <Sidebar isOpen={sidebarOpen} toggle={() => setSidebarOpen(!sidebarOpen)} />

      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Mobile Header */}
        <header className={`lg:hidden h-16 flex items-center justify-between px-4 shrink-0 shadow-md z-20 ${isDark ? 'bg-slate-800 text-white' : 'bg-primary text-white'}`}>
          <div className="flex items-center gap-3">
            {appSettings.logo ? (
              <img src={appSettings.logo} alt="Logo" className="w-8 h-8 object-contain rounded" />
            ) : (
              <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-[10px] font-black">
                {appInitials || 'KV'}
              </div>
            )}
            <span className="font-black tracking-tight truncate max-w-[130px] text-sm">{appSettings.name}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Dark Mode Toggle */}
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setBellOpen(!bellOpen)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors relative"
              >
                <Bell size={18} />
                {lowStockItems.length > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center ring-2 ring-white/20">
                    {lowStockItems.length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute top-12 right-0 w-80 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
                  <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
                    <h3 className="font-black text-sm text-slate-800 dark:text-white">Cảnh báo tồn kho</h3>
                    <button onClick={() => setBellOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                  </div>
                  {lowStockItems.length === 0 ? (
                    <div className="p-8 text-center text-slate-300">
                      <Package size={32} className="mx-auto mb-2 opacity-40" />
                      <p className="text-xs font-bold">Tồn kho ổn định</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
                      {lowStockItems.map(item => {
                        const totalStock = Object.values(item.stockByWarehouse).reduce((a: number, b) => a + (b as number), 0);
                        return (
                          <div key={item.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                            <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center shrink-0">
                              <AlertTriangle size={14} className="text-red-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
                              <p className="text-[10px] text-red-500 font-bold">Còn {totalStock} {item.unit} / Min: {item.minStock}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        <main className={`flex-1 overflow-auto p-4 md:p-8 pb-24 lg:pb-8 ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
          {isLoading || isRefreshing ? (
            <div className="h-full w-full flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm">
              <RefreshCw size={48} className="text-accent animate-spin mb-4" />
              <h3 className={`text-xl font-black ${isDark ? 'text-white' : 'text-slate-800'}`}>
                {isLoading ? "Đang kết nối Supabase..." : "Đang đồng bộ dữ liệu..."}
              </h3>
              <p className="text-slate-500 font-medium mt-1">Hệ thống đang thiết lập môi trường vận hành an toàn.</p>
            </div>
          ) : (
            <div className="max-w-7xl mx-auto w-full">
              <Outlet />
            </div>
          )}
        </main>
        <BottomNav />
      </div>

      {/* Click outside to close bell */}
      {bellOpen && <div className="fixed inset-0 z-40" onClick={() => setBellOpen(false)} />}
    </div>
  );
};

export default Layout;
