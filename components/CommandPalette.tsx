import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  Search, X, Users, Package, ArrowLeftRight, ClipboardCheck, Briefcase,
  FileText, Hash, ArrowRight, Command, CornerDownLeft, ChevronUp, User,
  Warehouse, DollarSign, Calendar, Settings
} from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  icon: React.ReactNode;
  route: string;
  keywords: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  'Nhân sự': { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-400', icon: <Users size={12} /> },
  'Vật tư': { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', icon: <Package size={12} /> },
  'Phiếu kho': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', icon: <ArrowLeftRight size={12} /> },
  'Yêu cầu': { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', icon: <ClipboardCheck size={12} /> },
  'Người dùng': { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-400', icon: <User size={12} /> },
  'Kho': { bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-400', icon: <Warehouse size={12} /> },
  'Trang': { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', icon: <FileText size={12} /> },
};

// Quick navigation pages
const PAGES: SearchResult[] = [
  { id: 'p-dash', title: 'Dashboard Kho', subtitle: 'Tổng quan kho vật tư', category: 'Trang', icon: <Settings size={16} />, route: '/dashboard', keywords: 'dashboard tong quan kho' },
  { id: 'p-inv', title: 'Tồn kho', subtitle: 'Danh sách vật tư', category: 'Trang', icon: <Package size={16} />, route: '/inventory', keywords: 'ton kho vat tu san pham' },
  { id: 'p-ops', title: 'Phiếu kho', subtitle: 'Nhập xuất chuyển kho', category: 'Trang', icon: <ArrowLeftRight size={16} />, route: '/operations', keywords: 'phieu kho nhap xuat chuyen' },
  { id: 'p-emp', title: 'Hồ sơ nhân sự', subtitle: 'Danh sách nhân viên', category: 'Trang', icon: <Users size={16} />, route: '/hrm/employees', keywords: 'nhan su nhan vien ho so' },
  { id: 'p-att', title: 'Chấm công', subtitle: 'Bảng chấm công', category: 'Trang', icon: <Calendar size={16} />, route: '/hrm/attendance', keywords: 'cham cong ngay lam' },
  { id: 'p-pay', title: 'Bảng lương', subtitle: 'Tính lương hàng tháng', category: 'Trang', icon: <DollarSign size={16} />, route: '/hrm/payroll', keywords: 'bang luong tinh luong thang' },
  { id: 'p-3p', title: 'Lương 3P', subtitle: 'Cấu hình bậc lương 3P', category: 'Trang', icon: <DollarSign size={16} />, route: '/hrm/salary-3p', keywords: 'luong 3p bac luong kpi' },
  { id: 'p-leave', title: 'Nghỉ phép', subtitle: 'Quản lý phép năm', category: 'Trang', icon: <Calendar size={16} />, route: '/hrm/leave', keywords: 'nghi phep phep nam' },
  { id: 'p-req', title: 'Yêu cầu vật tư', subtitle: 'Phiếu yêu cầu', category: 'Trang', icon: <ClipboardCheck size={16} />, route: '/requests', keywords: 'yeu cau vat tu phieu' },
  { id: 'p-wf', title: 'Quy trình', subtitle: 'Workflow instances', category: 'Trang', icon: <Briefcase size={16} />, route: '/wf', keywords: 'quy trinh workflow' },
  { id: 'p-settings', title: 'Cài đặt', subtitle: 'Cấu hình hệ thống', category: 'Trang', icon: <Settings size={16} />, route: '/settings', keywords: 'cai dat he thong settings' },
];

// Remove Vietnamese diacritics for fuzzy matching
const removeDiacritics = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { employees, items, transactions, requests, users, warehouses, suppliers } = useApp();

  // Build search index
  const allResults = useMemo<SearchResult[]>(() => {
    const results: SearchResult[] = [...PAGES];

    // Employees
    employees.forEach((e: any) => {
      results.push({
        id: `emp-${e.id}`,
        title: e.fullName || 'N/A',
        subtitle: `${e.employeeCode || ''} • ${e.title || 'Nhân viên'}`,
        category: 'Nhân sự',
        icon: <Users size={16} />,
        route: '/hrm/employees',
        keywords: `${e.fullName} ${e.employeeCode} ${e.phone} ${e.email} ${e.title}`,
      });
    });

    // Items
    items.forEach((item: any) => {
      results.push({
        id: `item-${item.id}`,
        title: item.name,
        subtitle: `${item.sku} • ${item.unit}`,
        category: 'Vật tư',
        icon: <Package size={16} />,
        route: '/inventory',
        keywords: `${item.name} ${item.sku} ${item.category} ${item.unit}`,
      });
    });

    // Transactions
    transactions.forEach((tx: any) => {
      const typeLabels: Record<string, string> = { 'IN': 'Nhập kho', 'OUT': 'Xuất kho', 'TRANSFER': 'Chuyển kho' };
      results.push({
        id: `tx-${tx.id}`,
        title: `${typeLabels[tx.type] || tx.type} — ${tx.date}`,
        subtitle: `${tx.status} • ${(tx.items || []).length} mặt hàng`,
        category: 'Phiếu kho',
        icon: <ArrowLeftRight size={16} />,
        route: '/operations',
        keywords: `${tx.type} ${tx.date} ${tx.status} ${tx.note || ''} phieu`,
      });
    });

    // Requests
    requests.forEach((req: any) => {
      results.push({
        id: `req-${req.id}`,
        title: `Yêu cầu ${req.code}`,
        subtitle: `${req.status} • ${req.createdDate || ''}`,
        category: 'Yêu cầu',
        icon: <ClipboardCheck size={16} />,
        route: '/requests',
        keywords: `${req.code} ${req.status} ${req.note || ''} yeu cau`,
      });
    });

    // Users
    users.forEach((u: any) => {
      results.push({
        id: `user-${u.id}`,
        title: u.name,
        subtitle: `${u.role} • ${u.email || u.username}`,
        category: 'Người dùng',
        icon: <User size={16} />,
        route: '/settings',
        keywords: `${u.name} ${u.email} ${u.username} ${u.role}`,
      });
    });

    // Warehouses
    warehouses.forEach((w: any) => {
      results.push({
        id: `wh-${w.id}`,
        title: w.name,
        subtitle: `${w.address || 'Kho'} • ${w.type || ''}`,
        category: 'Kho',
        icon: <Warehouse size={16} />,
        route: '/dashboard',
        keywords: `${w.name} ${w.address} kho`,
      });
    });

    return results;
  }, [employees, items, transactions, requests, users, warehouses]);

  // Filter results
  const filteredResults = useMemo(() => {
    if (!query.trim()) {
      // Show pages when no query
      return PAGES.slice(0, 8);
    }
    const q = removeDiacritics(query.trim());
    const words = q.split(/\s+/);

    return allResults
      .filter(r => {
        const target = removeDiacritics(r.keywords + ' ' + r.title + ' ' + r.subtitle);
        return words.every(w => target.includes(w));
      })
      .slice(0, 20);
  }, [query, allResults]);

  // Group results by category
  const groupedResults = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    filteredResults.forEach(r => {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r);
    });
    return groups;
  }, [filteredResults]);

  const flatResults = useMemo((): SearchResult[] => {
    const flat: SearchResult[] = [];
    const groups = Object.values(groupedResults) as SearchResult[][];
    groups.forEach(group => flat.push(...group));
    return flat;
  }, [groupedResults]);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Scroll selected into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('[data-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((result: SearchResult) => {
    setIsOpen(false);
    navigate(result.route);
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults[selectedIndex]) {
        handleSelect(flatResults[selectedIndex]);
      }
    }
  };

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh]" onClick={() => setIsOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'commandPaletteIn 0.15s ease-out' }}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <Search size={20} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tìm nhân sự, vật tư, phiếu, trang..."
            className="flex-1 bg-transparent text-base font-medium text-slate-800 dark:text-white placeholder-slate-400 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {flatResults.length === 0 ? (
            <div className="py-12 text-center">
              <Search size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-400">Không tìm thấy kết quả</p>
              <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">Thử từ khóa khác hoặc tìm bằng mã</p>
            </div>
          ) : (
            (Object.entries(groupedResults) as [string, SearchResult[]][]).map(([category, results]) => {
              const catInfo = CATEGORY_COLORS[category] || CATEGORY_COLORS['Trang'];
              return (
                <div key={category} className="mb-1">
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${catInfo.bg} ${catInfo.text}`}>
                      {catInfo.icon} {category}
                    </span>
                    <span className="text-[10px] text-slate-300 dark:text-slate-600 font-bold">{results.length}</span>
                  </div>
                  {/* Results in category */}
                  {results.map(result => {
                    const currentFlatIndex = flatIndex++;
                    const isSelected = currentFlatIndex === selectedIndex;
                    return (
                      <button
                        key={result.id}
                        data-selected={isSelected}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(currentFlatIndex)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-100 group ${
                          isSelected
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-800'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        {/* Icon */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition ${
                          isSelected
                            ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}>
                          {result.icon}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-bold truncate ${isSelected ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>
                            {highlightMatch(result.title, query)}
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{result.subtitle}</div>
                        </div>
                        {/* Arrow */}
                        {isSelected && (
                          <ArrowRight size={14} className="text-indigo-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-4 text-[10px] font-bold text-slate-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">↑↓</kbd>
            di chuyển
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">↵</kbd>
            mở
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">esc</kbd>
            đóng
          </span>
          <span className="ml-auto text-slate-300 dark:text-slate-600">
            Vioo Search
          </span>
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes commandPaletteIn {
          from { transform: scale(0.95) translateY(-10px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// Highlight matching text
function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const q = removeDiacritics(query.trim());
  const normalized = removeDiacritics(text);
  const idx = normalized.indexOf(q);
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export default CommandPalette;
