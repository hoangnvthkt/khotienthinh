import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { Employee } from '../../types';
import { Plus, Search, Edit2, Trash2, Phone, Mail, MapPin, Building, Briefcase, Users } from 'lucide-react';
import EmployeeModal from '../../components/hrm/EmployeeModal';
import EmployeeDetailModal from '../../components/hrm/EmployeeDetailModal';
import Pagination from '../../components/Pagination';
import { usePagination } from '../../hooks/usePagination';

const Employees: React.FC = () => {
    const { employees, users, removeEmployee, hrmAreas, hrmOffices, hrmPositions } = useApp();
  useModuleData('hrm');
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp =>
            emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            emp.employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (emp.phone && emp.phone.includes(searchTerm))
        );
    }, [employees, searchTerm]);

    const { paginatedItems: paginatedEmployees, currentPage, totalPages, totalItems, pageSize, setPage, setPageSize, startIndex, endIndex } = usePagination<Employee>(filteredEmployees, 20);

    const handleEdit = (emp: Employee) => {
        setEditingEmployee(emp);
        setIsModalOpen(true);
    };

    const handleAdd = () => {
        setEditingEmployee(null);
        setIsModalOpen(true);
    };

    const handleView = (emp: Employee) => {
        setViewingEmployee(emp);
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Bạn có chắc chắn muốn xóa nhân sự này? Thao tác này có thể ảnh hưởng đến lịch sử giao dịch.')) {
            removeEmployee(id);
        }
    };

    // Stats
    const activeCount = employees.filter(e => e.status === 'Đang làm việc').length;
    const totalCount = employees.length;

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <Users size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white tracking-tight">Hồ Sơ Nhân Sự</h1>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">
                            <span className="text-emerald-500 font-bold">{activeCount}</span> đang làm việc / <span className="font-bold">{totalCount}</span> tổng nhân sự
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleAdd}
                    className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/30 text-sm font-bold w-full sm:w-auto justify-center"
                >
                    <Plus size={18} />
                    <span>Thêm Mới</span>
                </button>
            </div>

            <div className="bg-white dark:bg-slate-800/60 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/50 flex-1 flex flex-col overflow-hidden">
                {/* Search */}
                <div className="p-3 md:p-4 border-b border-slate-100 dark:border-slate-700/40">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Tìm kiếm theo Tên, Mã NV hoặc SĐT..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 outline-none transition-all placeholder:text-slate-400"
                        />
                        <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
                    </div>
                </div>

                {/* ========== MOBILE CARD VIEW ========== */}
                <div className="md:hidden flex-1 overflow-y-auto p-3 space-y-2.5">
                    {paginatedEmployees.map(emp => {
                        const area = emp.areaId ? hrmAreas.find(a => a.id === emp.areaId) : null;
                        const office = emp.officeId ? hrmOffices.find(o => o.id === emp.officeId) : null;
                        const position = emp.positionId ? hrmPositions.find(p => p.id === emp.positionId) : null;

                        return (
                            <div
                                key={emp.id}
                                onClick={() => handleView(emp)}
                                className="bg-slate-50 dark:bg-slate-700/30 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50 active:bg-slate-100 dark:active:bg-slate-700/50 transition cursor-pointer"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 bg-indigo-500/10 text-indigo-500 rounded-xl flex items-center justify-center font-black text-sm shrink-0">
                                            {emp.fullName.charAt(0)}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-bold text-sm text-slate-800 dark:text-white truncate">{emp.fullName}</p>
                                            <p className="text-[11px] text-indigo-500 font-bold">{emp.employeeCode}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0 ml-2">
                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${emp.status === 'Đang làm việc' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                                            {emp.status === 'Đang làm việc' ? 'Active' : emp.status}
                                        </span>
                                    </div>
                                </div>

                                {emp.title && (
                                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-2 font-medium">{emp.title}</p>
                                )}

                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    {area && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-md">
                                            <MapPin size={10} /> {area.name}
                                        </span>
                                    )}
                                    {office && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-md">
                                            <Building size={10} /> {office.name}
                                        </span>
                                    )}
                                    {position && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-md">
                                            <Briefcase size={10} /> {position.name}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 text-[11px] text-slate-500 min-w-0">
                                        {emp.phone && (
                                            <span className="flex items-center gap-1 shrink-0">
                                                <Phone size={11} /> {emp.phone}
                                            </span>
                                        )}
                                        {emp.email && (
                                            <span className="flex items-center gap-1 truncate">
                                                <Mail size={11} /> <span className="truncate">{emp.email}</span>
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-1 shrink-0 ml-2">
                                        <button onClick={(e) => { e.stopPropagation(); handleEdit(emp); }} className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition">
                                            <Edit2 size={14} />
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDelete(emp.id); }} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {filteredEmployees.length === 0 && (
                        <div className="p-8 text-center text-slate-500">
                            Chưa có nhân sự nào trong hệ thống.
                        </div>
                    )}
                </div>

                {/* ========== DESKTOP TABLE VIEW ========== */}
                <div className="hidden md:block flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase tracking-[0.12em] font-black text-slate-400 dark:text-slate-500">
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 w-[90px]">Mã NV</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 min-w-[140px]">Họ & Tên</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50">Chức Danh</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50">Khu Vực</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50">Văn Phòng</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50">Vị Trí</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 min-w-[160px]">Liên Hệ</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 text-center w-[100px]">Trạng Thái</th>
                                <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 text-center w-[80px]">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedEmployees.map((emp, idx) => (
                                <tr key={emp.id} onClick={() => handleView(emp)}
                                    className={`border-b border-slate-100/80 dark:border-slate-700/30 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5 transition-colors cursor-pointer ${idx % 2 === 0 ? '' : 'bg-slate-50/40 dark:bg-slate-800/20'}`}
                                >
                                    <td className="py-3 px-4">
                                        <span className="text-xs font-mono font-bold text-indigo-500 bg-indigo-500/8 px-2 py-0.5 rounded-md">{emp.employeeCode}</span>
                                    </td>
                                    <td className="py-3 px-4">
                                        <span className="text-[13px] font-bold text-slate-800 dark:text-white">{emp.fullName}</span>
                                    </td>
                                    <td className="py-3 px-4">
                                        <span className="text-xs text-slate-600 dark:text-slate-300">{emp.title || <span className="text-slate-300 dark:text-slate-600">—</span>}</span>
                                    </td>
                                    <td className="py-3 px-4">
                                        {emp.areaId ? (
                                            <span className="text-[11px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-md whitespace-nowrap">
                                                {hrmAreas.find(a => a.id === emp.areaId)?.name || '—'}
                                            </span>
                                        ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                                    </td>
                                    <td className="py-3 px-4">
                                        {emp.officeId ? (
                                            <span className="text-[11px] font-bold text-teal-600 bg-teal-50 dark:bg-teal-900/30 dark:text-teal-400 px-2 py-0.5 rounded-md whitespace-nowrap">
                                                {hrmOffices.find(o => o.id === emp.officeId)?.name || '—'}
                                            </span>
                                        ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                                    </td>
                                    <td className="py-3 px-4">
                                        {emp.positionId ? (
                                            <span className="text-[11px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-md whitespace-nowrap">
                                                {hrmPositions.find(p => p.id === emp.positionId)?.name || '—'}
                                            </span>
                                        ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="space-y-0.5">
                                            {emp.phone && <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{emp.phone}</p>}
                                            {emp.email && <p className="text-[11px] text-slate-400 truncate max-w-[180px]">{emp.email}</p>}
                                        </div>
                                    </td>
                                    <td className="py-3 px-4 text-center">
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${emp.status === 'Đang làm việc'
                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                                        }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${emp.status === 'Đang làm việc' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                            {emp.status}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-center">
                                        <div className="flex items-center justify-center gap-0.5">
                                            <button onClick={(e) => { e.stopPropagation(); handleEdit(emp); }}
                                                className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-all"
                                                title="Chỉnh sửa"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(emp.id); }}
                                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                                                title="Xóa"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredEmployees.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="py-16 text-center">
                                        <Users size={40} className="mx-auto mb-3 text-slate-200 dark:text-slate-700" />
                                        <p className="text-sm font-bold text-slate-400 dark:text-slate-500">Chưa có nhân sự nào trong hệ thống</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-700/40 px-4">
                    <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} startIndex={startIndex} endIndex={endIndex} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
                </div>
            </div>

            {isModalOpen && (
                <EmployeeModal
                    employee={editingEmployee}
                    onClose={() => setIsModalOpen(false)}
                />
            )}

            {viewingEmployee && (
                <EmployeeDetailModal
                    employee={viewingEmployee}
                    onClose={() => setViewingEmployee(null)}
                    onEdit={(emp) => {
                        setViewingEmployee(null);
                        handleEdit(emp);
                    }}
                />
            )}
        </div>
    );
};

export default Employees;
