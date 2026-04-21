import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { Employee, Role } from '../../types';
import { Plus, Search, Edit2, Trash2, Phone, Mail, MapPin, Building, Briefcase, Users, LayoutGrid, List, User as UserIcon } from 'lucide-react';
import EmployeeModal from '../../components/hrm/EmployeeModal';
import EmployeeDetailModal from '../../components/hrm/EmployeeDetailModal';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import Pagination from '../../components/Pagination';
import { usePagination } from '../../hooks/usePagination';
import { usePermission } from '../../hooks/usePermission';

const Employees: React.FC = () => {
    const { employees, users, removeEmployee, hrmAreas, hrmOffices, hrmPositions, hrmConstructionSites, orgUnits, user } = useApp();
    const { canManage } = usePermission();
    const canCRUD = canManage('/hrm/employees');
    useModuleData('hrm');
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
    const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
        return (localStorage.getItem('emp_view_mode') as 'grid' | 'table') || 'grid';
    });

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp =>
            emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            emp.employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (emp.phone && emp.phone.includes(searchTerm))
        );
    }, [employees, searchTerm]);

    const { paginatedItems: paginatedEmployees, currentPage, totalPages, totalItems, pageSize, setPage, setPageSize, startIndex, endIndex } = usePagination<Employee>(filteredEmployees, 20);

    const handleEdit = (emp: Employee) => { setEditingEmployee(emp); setIsModalOpen(true); };
    const handleAdd = () => { setEditingEmployee(null); setIsModalOpen(true); };
    const handleView = (emp: Employee) => { setViewingEmployee(emp); };
    const handleDelete = (emp: Employee) => {
        setDeletingEmployee(emp);
    };
    const handleConfirmDelete = () => {
        if (deletingEmployee) {
            removeEmployee(deletingEmployee.id);
            setDeletingEmployee(null);
        }
    };
    const toggleView = (mode: 'grid' | 'table') => {
        setViewMode(mode);
        localStorage.setItem('emp_view_mode', mode);
    };

    const activeCount = employees.filter(e => e.status === 'Đang làm việc').length;

    // Helper to get position name
    const getPositionName = (positionId?: string) => positionId ? hrmPositions.find(p => p.id === positionId)?.name : null;

    const getOfficeName = (officeId?: string) => officeId ? hrmOffices.find(o => o.id === officeId)?.name : null;

    const getConstructionSiteName = (csId?: string) => {
        if (!csId) return null;
        const cs = hrmConstructionSites.find(c => c.id === csId);
        if (cs) return cs.name;
        const ou = orgUnits.find(u => u.id === csId);
        return ou?.name || null;
    };
    const getDepartmentName = (deptId?: string) => {
        if (!deptId) return null;
        return orgUnits.find(u => u.id === deptId)?.name || null;
    };

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
                            <span className="text-emerald-500 font-bold">{activeCount}</span> đang làm việc / <span className="font-bold">{employees.length}</span> tổng
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700">
                        <button onClick={() => toggleView('grid')} className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`} title="Dạng thẻ">
                            <LayoutGrid size={16} />
                        </button>
                        <button onClick={() => toggleView('table')} className={`p-2 rounded-lg transition-all ${viewMode === 'table' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`} title="Dạng bảng">
                            <List size={16} />
                        </button>
                    </div>
                    {canCRUD && (
                        <button onClick={handleAdd} className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/30 text-sm font-bold flex-1 sm:flex-initial justify-center">
                            <Plus size={18} />
                            <span>Thêm Mới</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <input type="text" placeholder="Tìm kiếm theo Tên, Mã NV hoặc SĐT..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 outline-none transition-all placeholder:text-slate-400"
                />
                <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
            </div>

            {/* ═══════ CARD GRID VIEW ═══════ */}
            {viewMode === 'grid' && (
                <div className="flex-1 overflow-auto">
                    {paginatedEmployees.length === 0 ? (
                        <div className="text-center py-16">
                            <Users size={40} className="mx-auto mb-3 text-slate-200 dark:text-slate-700" />
                            <p className="text-sm font-bold text-slate-400">Chưa có nhân sự nào</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                            {paginatedEmployees.map(emp => {
                                const position = getPositionName(emp.positionId);
                                const office = getOfficeName(emp.officeId);
                                const constructionSite = getConstructionSiteName(emp.constructionSiteId);
                                const department = getDepartmentName(emp.departmentId);
                                const isActive = emp.status === 'Đang làm việc';
                                const workplace = office || constructionSite;

                                return (
                                    <div key={emp.id} onClick={() => handleView(emp)}
                                        className="group relative flex gap-2 p-2 rounded-lg bg-white dark:bg-[#1e2228] border border-slate-200/70 dark:border-slate-700/40 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-md transition-all cursor-pointer"
                                    >
                                        {/* Avatar bên trái */}
                                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600/40 shrink-0 flex items-center justify-center self-start">
                                            {emp.avatarUrl ? (
                                                <img src={emp.avatarUrl} alt={emp.fullName} className="w-full h-full object-cover" />
                                            ) : (
                                                <UserIcon size={22} className="text-slate-300 dark:text-slate-500" />
                                            )}
                                        </div>

                                        {/* Info bên phải — căn lề trái */}
                                        <div className="flex-1 min-w-0 text-left">
                                            {/* 1: Họ tên */}
                                            <p className="text-[10px] font-bold text-slate-800 dark:text-white truncate leading-tight">{emp.fullName}</p>
                                            {/* 2: Mã NV */}
                                            <span className="inline-block text-[7px] font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/15 px-1 py-px rounded mt-px">{emp.employeeCode}</span>
                                            {/* 3: Vị trí */}
                                            <p className="text-[8px] text-slate-500 dark:text-slate-400 truncate leading-tight mt-px">{position || emp.title || '—'}</p>
                                            {/* 4: Phòng ban + VP */}
                                            <div className="flex flex-wrap gap-0.5 mt-px">
                                                {department && <span className="text-[7px] font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/15 px-1 py-px rounded truncate">{department}</span>}
                                                {workplace && <span className="text-[7px] font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-500/15 px-1 py-px rounded truncate">{workplace}</span>}
                                            </div>
                                            {/* 5: SĐT */}
                                            <p className="text-[8px] text-slate-400 truncate leading-tight mt-px flex items-center gap-0.5">
                                                <Phone size={7} className="shrink-0" /> {emp.phone || '—'}
                                            </p>
                                            {/* 6: Email */}
                                            <p className="text-[7px] text-slate-400 truncate leading-tight flex items-center gap-0.5">
                                                <Mail size={7} className="shrink-0" /> {emp.email || '—'}
                                            </p>
                                            {/* 7: Trạng thái */}
                                            <span className={`inline-flex items-center gap-0.5 text-[7px] font-bold px-1 py-px rounded mt-0.5 ${isActive ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-400' : 'text-red-600 bg-red-50 dark:bg-red-500/15 dark:text-red-400'}`}>
                                                <span className={`w-1 h-1 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                {emp.status}
                                            </span>
                                        </div>

                                        {/* Actions hover — Admin only */}
                                        {canCRUD && (
                                            <div className="absolute top-1 right-1 flex gap-px opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={(e) => { e.stopPropagation(); handleEdit(emp); }} className="p-0.5 text-slate-300 hover:text-indigo-500 rounded transition-all" title="Sửa"><Edit2 size={9} /></button>
                                                <button onClick={(e) => { e.stopPropagation(); handleDelete(emp); }} className="p-0.5 text-slate-300 hover:text-red-500 rounded transition-all" title="Xóa"><Trash2 size={9} /></button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ═══════ TABLE VIEW ═══════ */}
            {viewMode === 'table' && (
                <div className="bg-white dark:bg-slate-800/60 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/50 flex-1 flex flex-col overflow-hidden">
                    {/* Mobile Cards */}
                    <div className="md:hidden flex-1 overflow-y-auto p-3 space-y-2.5">
                        {paginatedEmployees.map(emp => {

                            const office = getOfficeName(emp.officeId);
                            const position = getPositionName(emp.positionId);
                            return (
                                <div key={emp.id} onClick={() => handleView(emp)} className="bg-slate-50 dark:bg-slate-700/30 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50 cursor-pointer">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700 shrink-0 flex items-center justify-center">
                                            {emp.avatarUrl ? <img src={emp.avatarUrl} alt="" className="w-full h-full object-cover" /> : <UserIcon size={18} className="text-slate-400" />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-sm text-slate-800 dark:text-white truncate">{emp.fullName}</p>
                                            <p className="text-[11px] text-indigo-500 font-bold">{emp.employeeCode}</p>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${emp.status === 'Đang làm việc' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                                            {emp.status === 'Đang làm việc' ? 'Active' : emp.status}
                                        </span>
                                    </div>
                                    {position && <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold mb-1">📍 {position}</p>}
                                    <div className="flex flex-wrap gap-1">

                                        {office && <span className="text-[9px] font-bold text-teal-600 bg-teal-50 dark:bg-teal-900/30 dark:text-teal-400 px-2 py-0.5 rounded">{office}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Desktop Table */}
                    <div className="hidden md:block flex-1 overflow-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 z-10">
                                <tr className="bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase tracking-[0.12em] font-black text-slate-400 dark:text-slate-500">
                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 w-[50px]"></th>
                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 w-[90px]">Mã NV</th>
                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 min-w-[140px]">Họ & Tên</th>
                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50">Vị Trí</th>
                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50">Chức Danh</th>

                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50">Văn Phòng</th>
                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 min-w-[150px]">Liên Hệ</th>
                                    <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 text-center w-[100px]">Trạng Thái</th>
                                    {canCRUD && <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 text-center w-[80px]">Thao Tác</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedEmployees.map((emp, idx) => {
                                    const position = getPositionName(emp.positionId);
                                    const office = getOfficeName(emp.officeId);
                                    const isActive = emp.status === 'Đang làm việc';
                                    return (
                                        <tr key={emp.id} onClick={() => handleView(emp)}
                                            className={`border-b border-slate-100/80 dark:border-slate-700/30 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5 transition-colors cursor-pointer ${idx % 2 === 0 ? '' : 'bg-slate-50/40 dark:bg-slate-800/20'}`}
                                        >
                                            <td className="py-2.5 px-4">
                                                <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center">
                                                    {emp.avatarUrl ? <img src={emp.avatarUrl} alt="" className="w-full h-full object-cover" /> : <UserIcon size={14} className="text-slate-300 dark:text-slate-500" />}
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-4"><span className="text-xs font-mono font-bold text-indigo-500 bg-indigo-500/8 px-2 py-0.5 rounded-md">{emp.employeeCode}</span></td>
                                            <td className="py-2.5 px-4"><span className="text-[13px] font-bold text-slate-800 dark:text-white">{emp.fullName}</span></td>
                                            <td className="py-2.5 px-4">{position ? <span className="text-[11px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-md whitespace-nowrap">{position}</span> : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}</td>
                                            <td className="py-2.5 px-4"><span className="text-xs text-slate-600 dark:text-slate-300">{emp.title || <span className="text-slate-300 dark:text-slate-600">—</span>}</span></td>

                                            <td className="py-2.5 px-4">{office ? <span className="text-[11px] font-bold text-teal-600 bg-teal-50 dark:bg-teal-900/30 dark:text-teal-400 px-2 py-0.5 rounded-md whitespace-nowrap">{office}</span> : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}</td>
                                            <td className="py-2.5 px-4">
                                                <div className="space-y-0.5">
                                                    {emp.phone && <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{emp.phone}</p>}
                                                    {emp.email && <p className="text-[11px] text-slate-400 truncate max-w-[170px]">{emp.email}</p>}
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-4 text-center">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-red-500'}`} />{emp.status}
                                                </span>
                                            </td>
                                            {canCRUD && (
                                                <td className="py-2.5 px-4 text-center">
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        <button onClick={(e) => { e.stopPropagation(); handleEdit(emp); }} className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-all" title="Sửa"><Edit2 size={14} /></button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleDelete(emp); }} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all" title="Xóa"><Trash2 size={14} /></button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                                {filteredEmployees.length === 0 && (
                                    <tr><td colSpan={10} className="py-16 text-center"><Users size={40} className="mx-auto mb-3 text-slate-200 dark:text-slate-700" /><p className="text-sm font-bold text-slate-400">Chưa có nhân sự nào</p></td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Pagination */}
            <div className="bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/50 px-4">
                <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} startIndex={startIndex} endIndex={endIndex} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
            </div>

            {isModalOpen && <EmployeeModal employee={editingEmployee} onClose={() => setIsModalOpen(false)} />}
            {viewingEmployee && <EmployeeDetailModal employee={viewingEmployee} onClose={() => setViewingEmployee(null)} onEdit={(emp) => { setViewingEmployee(null); handleEdit(emp); }} />}

            <ConfirmDeleteModal
                isOpen={!!deletingEmployee}
                onClose={() => setDeletingEmployee(null)}
                onConfirm={handleConfirmDelete}
                title="Xác nhận xoá nhân sự"
                targetName={deletingEmployee?.fullName || ''}
                subtitle={deletingEmployee ? `Mã NV: ${deletingEmployee.employeeCode}` : undefined}
                warningText="Hành động này không thể hoàn tác. Toàn bộ dữ liệu liên quan (chấm công, phép, lương...) cũng sẽ bị xoá."
                countdownSeconds={3}
            />
        </div>
    );
};

export default Employees;
