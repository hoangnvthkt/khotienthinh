import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  Search, Users, MapPin, Building, Filter, ChevronDown,
  Phone, Mail, Briefcase, Calendar, IdCard, X
} from 'lucide-react';

const EmployeeDirectory: React.FC = () => {
  const { employees, users } = useApp();
  useModuleData('hrm');
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterDept, setFilterDept] = useState<string>('');

  // Unique departments
  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.departmentId) set.add(e.departmentId); });
    return Array.from(set);
  }, [employees]);

  // Filter & search
  const filtered = useMemo(() => {
    let list = [...employees];
    if (filterStatus) list = list.filter(e => e.status === filterStatus);
    if (filterDept) list = list.filter(e => e.departmentId === filterDept);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(e =>
        e.employeeCode.toLowerCase().includes(q) ||
        e.fullName.toLowerCase().includes(q) ||
        e.email?.toLowerCase().includes(q) ||
        e.phone?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  }, [employees, filterStatus, filterDept, searchText]);

  // KPI
  const total = employees.length;
  const active = employees.filter(e => e.status === 'Đang làm việc').length;
  const inactive = employees.filter(e => e.status === 'Đã nghỉ việc').length;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <IdCard className="text-sky-500" size={26} /> Hồ Sơ Tổng Hợp
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
            Tra cứu toàn bộ thông tin & hoạt động theo mã nhân viên
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card p-4 rounded-2xl text-center">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng nhân viên</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white">{total}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl text-center">
          <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Đang làm việc</p>
          <p className="text-2xl font-black text-emerald-600">{active}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl text-center">
          <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">Đã nghỉ</p>
          <p className="text-2xl font-black text-red-500">{inactive}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Tìm theo mã NV, tên, email, SĐT..."
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium outline-none focus:ring-2 focus:ring-sky-400/40 transition"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="Đang làm việc">Đang làm việc</option>
          <option value="Đã nghỉ việc">Đã nghỉ việc</option>
        </select>
      </div>

      {/* Employee Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(emp => {
          const linkedUser = users.find(u => u.id === emp.userId);
          const avatarUrl = emp.avatarUrl || linkedUser?.avatar || `https://i.pravatar.cc/150?u=${emp.email || emp.id}`;
          const isActive = emp.status === 'Đang làm việc';
          return (
            <div
              key={emp.id}
              onClick={() => navigate(`/ep/${emp.id}`)}
              className={`group glass-card rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-sky-500/10 hover:-translate-y-1 border ${isActive ? 'border-slate-200 dark:border-slate-700' : 'border-red-200 dark:border-red-800/40 opacity-70'}`}
            >
              {/* Top gradient bar */}
              <div className={`h-1.5 ${isActive ? 'bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500' : 'bg-gradient-to-r from-red-300 to-red-400'}`} />

              <div className="p-4 space-y-3">
                {/* Avatar + Badge */}
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <img
                      src={avatarUrl}
                      alt={emp.fullName}
                      className="w-14 h-14 rounded-xl object-cover ring-2 ring-white dark:ring-slate-700 shadow-md"
                    />
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-slate-800 ${isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 text-[10px] font-black tracking-wider">
                        {emp.employeeCode}
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-slate-800 dark:text-white truncate group-hover:text-sky-600 dark:group-hover:text-sky-400 transition">
                      {emp.fullName}
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium truncate">
                      {emp.title || 'Chưa có chức vụ'}
                    </p>
                  </div>
                </div>

                {/* Info rows */}
                <div className="space-y-1.5 text-[11px]">
                  {emp.phone && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Phone size={11} className="text-slate-400 shrink-0" />
                      <span className="truncate">{emp.phone}</span>
                    </div>
                  )}
                  {emp.email && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Mail size={11} className="text-slate-400 shrink-0" />
                      <span className="truncate">{emp.email}</span>
                    </div>
                  )}
                  {emp.startDate && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Calendar size={11} className="text-slate-400 shrink-0" />
                      <span>Vào làm: {new Date(emp.startDate).toLocaleDateString('vi-VN')}</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                    {emp.status}
                  </span>
                  <span className="text-[10px] font-black text-sky-500 opacity-0 group-hover:opacity-100 transition-all">
                    Xem hồ sơ →
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <Users className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
          <p className="text-slate-400 font-bold">Không tìm thấy nhân viên nào.</p>
          <p className="text-sm text-slate-300 dark:text-slate-500">Thử thay đổi từ khóa tìm kiếm.</p>
        </div>
      )}
    </div>
  );
};

export default EmployeeDirectory;
