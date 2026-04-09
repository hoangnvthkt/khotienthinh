import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  History, Search, Filter, ChevronDown, ChevronRight,
  Plus, Edit3, Trash2, Eye, Clock, User, Database,
  ArrowRight, RefreshCw, Download, Calendar
} from 'lucide-react';
import { auditService, AuditEntry, TABLE_LABELS, getFieldLabel } from '../lib/auditService';

// Module colors
const MODULE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  WMS: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-600 dark:text-blue-400', label: 'Kho & Vật tư' },
  HRM: { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-600 dark:text-purple-400', label: 'Nhân sự' },
  DA: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-600 dark:text-orange-400', label: 'Dự án' },
  TS: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-600 dark:text-emerald-400', label: 'Tài sản' },
  WF: { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-600 dark:text-teal-400', label: 'Quy trình' },
  RQ: { bg: 'bg-pink-50 dark:bg-pink-950/30', text: 'text-pink-600 dark:text-pink-400', label: 'Yêu cầu' },
  TC: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-600 dark:text-amber-400', label: 'Tài chính' },
  SYSTEM: { bg: 'bg-slate-50 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', label: 'Hệ thống' },
};

const ACTION_STYLES: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  INSERT: { icon: <Plus size={12} />, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30', label: 'Thêm mới' },
  UPDATE: { icon: <Edit3 size={12} />, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30', label: 'Cập nhật' },
  DELETE: { icon: <Trash2 size={12} />, color: 'text-red-600 bg-red-50 dark:bg-red-950/30', label: 'Xóa' },
};

const formatValue = (val: any): string => {
  if (val === null || val === undefined) return '(trống)';
  if (typeof val === 'boolean') return val ? 'Có' : 'Không';
  if (typeof val === 'object') return JSON.stringify(val).slice(0, 80);
  return String(val);
};

const timeAgo = (date: string): string => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(date).toLocaleDateString('vi-VN');
};

const AuditTrail: React.FC = () => {
  const { user } = useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterTable, setFilterTable] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const data = await auditService.list({
      module: filterModule || undefined,
      action: filterAction || undefined,
      tableName: filterTable || undefined,
      from: dateFrom || undefined,
      to: dateTo ? dateTo + 'T23:59:59Z' : undefined,
      limit: 200,
    });
    setEntries(data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [filterModule, filterAction, filterTable, dateFrom, dateTo]);

  const filteredEntries = useMemo(() => {
    if (!searchTerm) return entries;
    const term = searchTerm.toLowerCase();
    return entries.filter(e =>
      e.description.toLowerCase().includes(term) ||
      e.userName.toLowerCase().includes(term) ||
      e.recordId.toLowerCase().includes(term) ||
      (TABLE_LABELS[e.tableName] || e.tableName).toLowerCase().includes(term)
    );
  }, [entries, searchTerm]);

  // Get unique tables from entries
  const availableTables = useMemo(() => {
    const tables = new Set(entries.map(e => e.tableName));
    return Array.from(tables).sort();
  }, [entries]);

  // Stats
  const stats = useMemo(() => ({
    total: filteredEntries.length,
    inserts: filteredEntries.filter(e => e.action === 'INSERT').length,
    updates: filteredEntries.filter(e => e.action === 'UPDATE').length,
    deletes: filteredEntries.filter(e => e.action === 'DELETE').length,
  }), [filteredEntries]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <History className="text-indigo-500" size={24} /> Nhật ký thay đổi
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
            Theo dõi mọi thay đổi dữ liệu trong toàn hệ thống
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${showFilters ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200'}`}>
            <Filter size={14} /> Bộ lọc
          </button>
          <button onClick={loadData} disabled={loading}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Tổng</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{stats.total}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Thêm mới</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{stats.inserts}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Cập nhật</p>
          <p className="text-2xl font-black text-blue-600 mt-1">{stats.updates}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">Xóa</p>
          <p className="text-2xl font-black text-red-600 mt-1">{stats.deletes}</p>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="glass-card p-5 rounded-2xl space-y-4" style={{ animation: 'fadeSlideIn 0.2s ease-out' }}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Module</label>
              <select value={filterModule} onChange={e => setFilterModule(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 outline-none focus:border-indigo-400">
                <option value="">Tất cả</option>
                {Object.entries(MODULE_COLORS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Hành động</label>
              <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 outline-none focus:border-indigo-400">
                <option value="">Tất cả</option>
                <option value="INSERT">Thêm mới</option>
                <option value="UPDATE">Cập nhật</option>
                <option value="DELETE">Xóa</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Bảng dữ liệu</label>
              <select value={filterTable} onChange={e => setFilterTable(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 outline-none focus:border-indigo-400">
                <option value="">Tất cả</option>
                {availableTables.map(t => (
                  <option key={t} value={t}>{TABLE_LABELS[t] || t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Từ ngày</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Đến ngày</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 outline-none focus:border-indigo-400" />
            </div>
          </div>
          {(filterModule || filterAction || filterTable || dateFrom || dateTo) && (
            <button onClick={() => { setFilterModule(''); setFilterAction(''); setFilterTable(''); setDateFrom(''); setDateTo(''); }}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition">
              ✕ Xoá bộ lọc
            </button>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input type="text" placeholder="Tìm kiếm theo mô tả, người thực hiện, mã bản ghi..."
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-3.5 text-sm font-medium border border-slate-200 dark:border-slate-600 rounded-2xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400 transition" />
      </div>

      {/* Timeline */}
      <div className="space-y-2">
        {loading ? (
          <div className="glass-card p-20 rounded-2xl text-center">
            <RefreshCw size={32} className="mx-auto text-slate-300 animate-spin mb-3" />
            <p className="text-sm font-bold text-slate-400">Đang tải...</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="glass-card p-20 rounded-2xl text-center">
            <History size={48} className="mx-auto text-slate-200 dark:text-slate-600 mb-4" />
            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Chưa có dữ liệu</p>
            <p className="text-xs text-slate-400 mt-2">Các thay đổi dữ liệu sẽ tự động được ghi nhận tại đây</p>
          </div>
        ) : (
          filteredEntries.map((entry, idx) => {
            const isExpanded = expandedId === entry.id;
            const actionStyle = ACTION_STYLES[entry.action] || ACTION_STYLES.UPDATE;
            const moduleColor = MODULE_COLORS[entry.module] || MODULE_COLORS.SYSTEM;
            const changesCount = Object.keys(entry.changes).length;

            return (
              <div key={entry.id}
                className={`glass-card rounded-2xl overflow-hidden transition-all duration-200 ${isExpanded ? 'ring-2 ring-indigo-300/50' : ''}`}
                style={{ animation: `fadeSlideIn 0.15s ease-out ${Math.min(idx * 0.03, 0.3)}s both` }}>
                {/* Main Row */}
                <button onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition">
                  {/* Action icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${actionStyle.color}`}>
                    {actionStyle.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
                      {entry.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${moduleColor.bg} ${moduleColor.text}`}>
                        {moduleColor.label}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1">
                        <User size={10} /> {entry.userName}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1">
                        <Clock size={10} /> {timeAgo(entry.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Table Badge */}
                  <span className="hidden md:inline-flex px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 shrink-0">
                    <Database size={10} className="mr-1" /> {TABLE_LABELS[entry.tableName] || entry.tableName}
                  </span>

                  {/* Changes count */}
                  {changesCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 shrink-0">
                      {changesCount} trường
                    </span>
                  )}

                  {/* Expand arrow */}
                  <div className={`shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                    <ChevronRight size={16} className="text-slate-400" />
                  </div>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-5 space-y-4"
                    style={{ animation: 'fadeSlideIn 0.2s ease-out' }}>
                    {/* Meta info */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-slate-400 font-bold">Hành động</span>
                        <p className={`font-black mt-0.5 ${actionStyle.color.split(' ')[0]}`}>{actionStyle.label}</p>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold">Bảng dữ liệu</span>
                        <p className="font-black text-slate-800 dark:text-white mt-0.5">{TABLE_LABELS[entry.tableName] || entry.tableName}</p>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold">Mã bản ghi</span>
                        <p className="font-mono text-[10px] text-slate-600 dark:text-slate-300 mt-0.5 truncate">{entry.recordId}</p>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold">Thời gian</span>
                        <p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                          {new Date(entry.createdAt).toLocaleString('vi-VN')}
                        </p>
                      </div>
                    </div>

                    {/* Changes diff */}
                    {changesCount > 0 && (
                      <div>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Chi tiết thay đổi ({changesCount} trường)
                        </h4>
                        <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-100 dark:bg-slate-700">
                                <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase">Trường</th>
                                <th className="px-4 py-2.5 text-left text-[10px] font-black text-red-400 uppercase">Giá trị cũ</th>
                                <th className="px-4 py-2.5 text-center w-8"><ArrowRight size={12} className="text-slate-400 mx-auto" /></th>
                                <th className="px-4 py-2.5 text-left text-[10px] font-black text-emerald-500 uppercase">Giá trị mới</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-600">
                              {Object.entries(entry.changes).map(([field, change]) => (
                                <tr key={field} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
                                  <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">
                                    {getFieldLabel(field)}
                                  </td>
                                  <td className="px-4 py-2.5 text-red-500 dark:text-red-400 font-medium line-through opacity-60">
                                    {formatValue((change as any).from)}
                                  </td>
                                  <td className="text-center text-slate-300">→</td>
                                  <td className="px-4 py-2.5 text-emerald-600 dark:text-emerald-400 font-bold">
                                    {formatValue((change as any).to)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* INSERT data display */}
                    {entry.action === 'INSERT' && Object.keys(entry.newData).length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Dữ liệu thêm mới
                        </h4>
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                          {Object.entries(entry.newData).slice(0, 12).map(([k, v]) => (
                            <div key={k}>
                              <span className="text-[10px] font-bold text-slate-400">{getFieldLabel(k)}</span>
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{formatValue(v)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* CSS */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default AuditTrail;
