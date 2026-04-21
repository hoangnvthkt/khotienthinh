import React from 'react';
import { Employee, OrgUnit } from '../../types';
import {
  X, Phone, Mail, User, MapPin, Briefcase,
  Calendar, Shield, Hash
} from 'lucide-react';

interface EmployeePopupProps {
  employee: Employee;
  orgUnits: OrgUnit[];
  onClose: () => void;
}

const EmployeePopup: React.FC<EmployeePopupProps> = ({ employee, orgUnits, onClose }) => {
  const unit = employee.orgUnitId
    ? orgUnits.find(u => u.id === employee.orgUnitId)
    : null;

  const initial = employee.fullName.charAt(0).toUpperCase();
  const colors = ['#6366f1', '#0ea5e9', '#8b5cf6', '#f97316', '#10b981', '#ec4899', '#f59e0b'];
  const color = colors[employee.fullName.charCodeAt(0) % colors.length];

  const fields = [
    { icon: Hash, label: 'Mã nhân sự', value: employee.employeeCode },
    { icon: Briefcase, label: 'Chức danh', value: employee.title },
    { icon: MapPin, label: 'Đơn vị', value: unit?.name ?? '—' },
    { icon: Phone, label: 'Điện thoại', value: employee.phone },
    { icon: Mail, label: 'Email', value: employee.email },
    { icon: User, label: 'Giới tính', value: employee.gender },
    { icon: Calendar, label: 'Ngày vào làm', value: employee.startDate },
    { icon: Shield, label: 'Trạng thái', value: employee.status },
  ].filter(f => f.value);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm mx-4 rounded-3xl overflow-hidden shadow-2xl"
        style={{
          background: 'rgba(10,15,35,0.97)',
          border: `1px solid ${color}44`,
          boxShadow: `0 0 40px ${color}33, 0 25px 50px rgba(0,0,0,0.6)`,
        }}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4" style={{ background: `linear-gradient(135deg, ${color}22, transparent)` }}>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <X size={16} />
          </button>

          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-black shadow-xl shrink-0"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)`, boxShadow: `0 0 20px ${color}66` }}
            >
              {employee.avatarUrl
                ? <img src={employee.avatarUrl} alt="" className="w-full h-full object-cover rounded-2xl" />
                : initial}
            </div>

            <div>
              <h3 className="text-lg font-black text-white leading-tight">{employee.fullName}</h3>
              <p className="text-sm text-slate-400">{employee.title || 'Nhân viên'}</p>
              <span
                className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: employee.status === 'Đang làm việc' ? '#10b98120' : '#ef444420',
                  color: employee.status === 'Đang làm việc' ? '#10b981' : '#ef4444',
                }}
              >
                {employee.status}
              </span>
            </div>
          </div>
        </div>

        {/* Fields */}
        <div className="px-6 pb-6 space-y-2.5">
          <div className="h-px" style={{ background: `linear-gradient(to right, transparent, ${color}44, transparent)` }} />
          {fields.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: `${color}18` }}>
                <Icon size={12} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                <p className="text-xs font-semibold text-slate-200 truncate">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default EmployeePopup;
