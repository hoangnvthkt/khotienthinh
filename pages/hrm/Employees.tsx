import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Employee } from '../../types';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import EmployeeModal from '../../components/hrm/EmployeeModal';
import EmployeeDetailModal from '../../components/hrm/EmployeeDetailModal';
import Pagination from '../../components/Pagination';
import { usePagination } from '../../hooks/usePagination';

const Employees: React.FC = () => {
    const { employees, users, removeEmployee, hrmAreas, hrmOffices, hrmPositions } = useApp();
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

    return (
        <div className="p-6 h-full flex flex-col space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Nhân sự</h1>
                    <p className="text-sm text-slate-500 font-medium">Quản lý hồ sơ nhân sự của công ty</p>
                </div>
                <button
                    onClick={handleAdd}
                    className="flex items-center space-x-2 bg-accent hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-all shadow-lg hover:shadow-blue-500/30 text-sm font-bold uppercase"
                >
                    <Plus size={18} />
                    <span>Thêm Mới</span>
                </button>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-4">
                <div className="relative mb-4">
                    <input
                        type="text"
                        placeholder="Tìm kiếm theo Tên, Mã NV hoặc SĐT..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 focus:ring-accent"
                    />
                    <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider font-black">
                                <th className="p-4 border-b dark:border-slate-700">Mã NV</th>
                                <th className="p-4 border-b dark:border-slate-700">Họ & Tên</th>
                                <th className="p-4 border-b dark:border-slate-700">Chức Danh</th>
                                <th className="p-4 border-b dark:border-slate-700">Khu Vực</th>
                                <th className="p-4 border-b dark:border-slate-700">Văn Phòng</th>
                                <th className="p-4 border-b dark:border-slate-700">Vị Trí</th>
                                <th className="p-4 border-b dark:border-slate-700">Liên Hệ</th>
                                <th className="p-4 border-b dark:border-slate-700">Trạng Thái</th>
                                <th className="p-4 border-b dark:border-slate-700 text-right">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {paginatedEmployees.map(emp => (
                                <tr key={emp.id} onClick={() => handleView(emp)} className="border-b dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition cursor-pointer">
                                    <td className="p-4 font-bold text-accent">{emp.employeeCode}</td>
                                    <td className="p-4 font-bold text-slate-800 dark:text-white">{emp.fullName}</td>
                                    <td className="p-4 text-slate-600 dark:text-slate-300">{emp.title}</td>
                                    <td className="p-4">
                                        {emp.areaId ? (
                                            <span className="text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-1 rounded-lg">
                                                {hrmAreas.find(a => a.id === emp.areaId)?.name || '--'}
                                            </span>
                                        ) : <span className="text-xs text-slate-400">--</span>}
                                    </td>
                                    <td className="p-4">
                                        {emp.officeId ? (
                                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-1 rounded-lg">
                                                {hrmOffices.find(o => o.id === emp.officeId)?.name || '--'}
                                            </span>
                                        ) : <span className="text-xs text-slate-400">--</span>}
                                    </td>
                                    <td className="p-4">
                                        {emp.positionId ? (
                                            <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded-lg">
                                                {hrmPositions.find(p => p.id === emp.positionId)?.name || '--'}
                                            </span>
                                        ) : <span className="text-xs text-slate-400">--</span>}
                                    </td>
                                    <td className="p-4">
                                        <p className="text-slate-800 dark:text-slate-200">{emp.phone}</p>
                                        <p className="text-xs text-slate-500">{emp.email}</p>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded-md text-xs font-bold ${emp.status === 'Đang làm việc' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                                            {emp.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <button onClick={(e) => { e.stopPropagation(); handleEdit(emp); }} className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg mr-2 transition">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDelete(emp.id); }} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition">
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filteredEmployees.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="p-8 text-center text-slate-500">
                                        Chưa có nhân sự nào trong hệ thống.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
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
