import React from 'react';
import {
  AlertTriangle, BarChart3, Boxes, ClipboardList, FileCheck2,
  Handshake, PackageSearch, RefreshCw, Truck,
} from 'lucide-react';
import type { ProcurementView } from '../../types/procurementWorkbench';

const NAV: Array<{ key: ProcurementView; label: string; icon: React.ElementType }> = [
  { key: 'work', label: 'Việc của tôi', icon: FileCheck2 },
  { key: 'demand', label: 'Nhu cầu cung ứng', icon: ClipboardList },
  { key: 'orders', label: 'Đơn mua', icon: PackageSearch },
  { key: 'receiving', label: 'Giao nhận', icon: Truck },
  { key: 'reconcile', label: 'Đối chiếu', icon: AlertTriangle },
  { key: 'partners', label: 'Hợp đồng & NCC', icon: Handshake },
  { key: 'overview', label: 'Tổng quan', icon: BarChart3 },
];

export const WorkbenchShell: React.FC<{
  view: ProcurementView;
  onViewChange: (view: ProcurementView) => void;
  onRefresh: () => void;
  refreshing: boolean;
  children: React.ReactNode;
}> = ({ view, onViewChange, onRefresh, refreshing, children }) => (
  <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-5 sm:py-5">
    <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.16),_transparent_42%)] px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
            <Boxes size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Mua hàng & Cung ứng</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Nhu cầu đúng người, xử lý tại một nơi</h1>
            <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500 dark:text-slate-400">Theo dõi phần còn thiếu, người phụ trách và bước cần làm tiếp theo từ cùng một nguồn số liệu.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
          Làm mới
        </button>
      </div>
      <nav aria-label="Khu vực mua hàng" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-2 dark:border-slate-800 sm:px-4">
        {NAV.map(item => {
          const Icon = item.icon;
          const active = item.key === view;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onViewChange(item.key)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${active
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'}`}
            >
              <Icon size={16} /> {item.label}
            </button>
          );
        })}
      </nav>
    </header>
    <div className="mt-4">{children}</div>
  </main>
);
