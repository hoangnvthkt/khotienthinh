import React, { useMemo } from 'react';
import { OrgUnit, Employee } from '../../types';
import { useOrgMapStore } from './useOrgMapStore';
import {
  Search, X, ChevronLeft, Users, Building2, MapPin,
  Filter, Eye
} from 'lucide-react';

interface OrgSidebarProps {
  orgUnits: OrgUnit[];
  employees: Employee[];
}

const OrgSidebar: React.FC<OrgSidebarProps> = ({ orgUnits, employees }) => {
  const {
    sidebarOpen, toggleSidebar,
    filterUnitId, setFilterUnitId,
    searchQuery, setSearchQuery,
    setSelectedEmployee, setCameraMode,
  } = useOrgMapStore();

  const filtered = useMemo(() => {
    return employees.filter(emp => {
      const matchUnit = !filterUnitId || emp.orgUnitId === filterUnitId;
      const q = searchQuery.toLowerCase();
      const matchSearch = !q ||
        emp.fullName.toLowerCase().includes(q) ||
        emp.title?.toLowerCase().includes(q) ||
        emp.employeeCode?.toLowerCase().includes(q);
      return matchUnit && matchSearch && emp.status === 'Đang làm việc';
    });
  }, [employees, filterUnitId, searchQuery]);

  const unitMap = useMemo(
    () => Object.fromEntries(orgUnits.map(u => [u.id, u])),
    [orgUnits]
  );

  const unitCounts = useMemo(() => {
    const m: Record<string, number> = {};
    employees.forEach(e => {
      if (e.orgUnitId) m[e.orgUnitId] = (m[e.orgUnitId] ?? 0) + 1;
    });
    return m;
  }, [employees]);

  if (!sidebarOpen) {
    return (
      <button
        onClick={toggleSidebar}
        className="absolute top-4 right-4 z-20 w-10 h-10 rounded-xl bg-slate-900/90 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-lg"
      >
        <Users size={18} />
      </button>
    );
  }

  return (
    <div className="absolute top-0 right-0 h-full w-72 z-20 flex flex-col"
      style={{ background: 'rgba(8,14,28,0.92)', backdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(99,102,241,0.2)' }}>

      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
            <Users size={14} className="text-indigo-400" />
          </div>
          <span className="font-bold text-sm text-white">Nhân viên</span>
          <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/20 px-1.5 py-0.5 rounded-full">
            {filtered.length}
          </span>
        </div>
        <button onClick={toggleSidebar} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-500 hover:text-white transition-colors">
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b" style={{ borderColor: 'rgba(99,102,241,0.15)' }}>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm nhân viên..."
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-indigo-500"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(99,102,241,0.2)' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Filter by unit */}
      <div className="px-3 py-2 border-b" style={{ borderColor: 'rgba(99,102,241,0.15)' }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Filter size={11} className="text-slate-500" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Lọc theo đơn vị</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterUnitId(null)}
            className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${!filterUnitId ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
          >
            Tất cả
          </button>
          {orgUnits.filter(u => unitCounts[u.id]).map(u => (
            <button
              key={u.id}
              onClick={() => setFilterUnitId(filterUnitId === u.id ? null : u.id)}
              className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${filterUnitId === u.id ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
            >
              {u.name.replace('Phòng ', '')} ({unitCounts[u.id]})
            </button>
          ))}
        </div>
      </div>

      {/* Employee list */}
      <div className="flex-1 overflow-y-auto py-2 space-y-1 px-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Users size={28} className="text-slate-600 mb-2" />
            <p className="text-xs text-slate-500">Không tìm thấy nhân viên</p>
          </div>
        ) : (
          filtered.map(emp => {
            const unit = emp.orgUnitId ? unitMap[emp.orgUnitId] : null;
            const initial = emp.fullName.charAt(0).toUpperCase();
            const colors = ['#6366f1', '#0ea5e9', '#8b5cf6', '#f97316', '#10b981', '#ec4899'];
            const color = colors[emp.fullName.charCodeAt(0) % colors.length];

            return (
              <button
                key={emp.id}
                onClick={() => {
                  setSelectedEmployee(emp);
                  if (emp.orgUnitId) {
                    const u = unitMap[emp.orgUnitId];
                    if (u) setCameraMode({ type: 'room', unitId: u.id });
                  }
                }}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/5 transition-all group text-left"
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 shadow-md"
                  style={{ background: color, boxShadow: `0 0 8px ${color}66` }}>
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{emp.fullName}</div>
                  <div className="text-[10px] text-slate-400 truncate">{emp.title || 'Nhân viên'}</div>
                  {unit && (
                    <div className="text-[9px] text-indigo-400 truncate flex items-center gap-0.5 mt-0.5">
                      <MapPin size={9} />
                      {unit.name.replace('Phòng ', '')}
                    </div>
                  )}
                </div>
                <Eye size={12} className="text-slate-600 group-hover:text-indigo-400 transition-colors shrink-0" />
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t text-center" style={{ borderColor: 'rgba(99,102,241,0.15)' }}>
        <p className="text-[10px] text-slate-600">{employees.filter(e => e.status === 'Đang làm việc').length} nhân viên đang làm việc</p>
      </div>
    </div>
  );
};

export default OrgSidebar;
