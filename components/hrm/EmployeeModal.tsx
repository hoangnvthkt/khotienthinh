import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Employee } from '../../types';
import { X, Save, User as UserIcon, MapPinned, Building, Layers, HardHat, DollarSign, Calendar } from 'lucide-react';

interface EmployeeModalProps {
    employee: Employee | null;
    onClose: () => void;
}

const EmployeeModal: React.FC<EmployeeModalProps> = ({ employee, onClose }) => {
    const { addEmployee, updateEmployee, users, employees, hrmAreas, hrmOffices, hrmEmployeeTypes, hrmPositions, hrmSalaryPolicies, hrmWorkSchedules } = useApp();
    const [formData, setFormData] = useState<Partial<Employee>>({
        fullName: '',
        title: '',
        gender: 'Nam',
        phone: '',
        email: '',
        dateOfBirth: '',
        startDate: '',
        officialDate: '',
        status: 'Đang làm việc',
        userId: undefined,
        areaId: undefined,
        officeId: undefined,
        employeeTypeId: undefined,
        positionId: undefined,
        salaryPolicyId: undefined,
        workScheduleId: undefined,
        maritalStatus: ''
    });

    useEffect(() => {
        if (employee) {
            setFormData(employee);
        }
    }, [employee]);

    // Tìm các users chưa được gán cho nhân sự nào (ngoại trừ user đang được gán cho nhân sự hiện tại)
    const availableUsers = users.filter(usr => {
        const isLinkedToOther = employees.some(emp => emp.userId === usr.id && emp.id !== employee?.id);
        return !isLinkedToOther;
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.fullName) return;

        if (employee && employee.id) {
            updateEmployee(formData as Employee);
        } else {
            const newEmployee: Employee = {
                ...formData,
                id: crypto.randomUUID(), // Temp ID, will be overwritten by Supabase Realtime if necessary or respected
                employeeCode: '', // Leave empty to let Supabase Sequence trigger
            } as Employee;
            addEmployee(newEmployee);
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-accent">
                            <UserIcon size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight">
                                {employee ? 'Sửa Hồ Sơ Nhân Sự' : 'Thêm Nhân Sự Mới'}
                            </h2>
                            <p className="text-xs text-slate-500 font-medium">Bổ sung hoặc cập nhật thông tin nhân viên</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <form id="employee-form" onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mã Nhân Sự</label>
                                <input
                                    type="text"
                                    value={employee ? employee.employeeCode : 'Tự động tạo (TT00x)'}
                                    disabled
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 text-sm font-bold"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Họ & Tên *</label>
                                <input
                                    type="text"
                                    name="fullName"
                                    required
                                    value={formData.fullName || ''}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                    placeholder="Nguyễn Văn A"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Chức Danh</label>
                                <input
                                    type="text"
                                    name="title"
                                    value={formData.title || ''}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                    placeholder="Ví dụ: Kế toán, Thủ kho..."
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Giới Tính</label>
                                <select
                                    name="gender"
                                    value={formData.gender}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                >
                                    <option value="Nam">Nam</option>
                                    <option value="Nữ">Nữ</option>
                                    <option value="Khác">Khác</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Số Điện Thoại</label>
                                <input
                                    type="tel"
                                    name="phone"
                                    value={formData.phone || ''}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                    placeholder="0912345678"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Email</label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email || ''}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                    placeholder="email@example.com"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày Sinh</label>
                                <input
                                    type="date"
                                    name="dateOfBirth"
                                    value={formData.dateOfBirth || ''}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tình Trạng</label>
                                <select
                                    name="status"
                                    value={formData.status}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                >
                                    <option value="Đang làm việc">Đang làm việc</option>
                                    <option value="Đã nghỉ việc">Đã nghỉ việc</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày Bắt Đầu (Thử Việc)</label>
                                <input
                                    type="date"
                                    name="startDate"
                                    value={formData.startDate || ''}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày Ký Chính Thức</label>
                                <input
                                    type="date"
                                    name="officialDate"
                                    value={formData.officialDate || ''}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                />
                            </div>
                        </div>

                        {/* ===== HRM MASTER DATA SECTION ===== */}
                        <div className="border-t border-slate-100 dark:border-slate-800 pt-6 mt-6">
                            <h3 className="text-sm font-black text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Layers size={16} /> Thông tin chính
                            </h3>
                            <p className="text-[10px] text-slate-400 mb-4">Chọn thông tin từ dữ liệu gốc HRM đã khai báo trong Cài đặt.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <MapPinned size={12} /> Khu vực / Chuyên môn *
                                    </label>
                                    <select
                                        name="areaId"
                                        value={formData.areaId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-violet-200 dark:border-violet-800/30 bg-violet-50 dark:bg-violet-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-violet-500"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {hrmAreas.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <Building size={12} /> Văn phòng *
                                    </label>
                                    <select
                                        name="officeId"
                                        value={formData.officeId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-violet-200 dark:border-violet-800/30 bg-violet-50 dark:bg-violet-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-violet-500"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {hrmOffices.map(o => (<option key={o.id} value={o.id}>{o.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <Layers size={12} /> Phân loại nhân sự *
                                    </label>
                                    <select
                                        name="employeeTypeId"
                                        value={formData.employeeTypeId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-violet-200 dark:border-violet-800/30 bg-violet-50 dark:bg-violet-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-violet-500"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {hrmEmployeeTypes.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <HardHat size={12} /> Vị trí công việc *
                                    </label>
                                    <select
                                        name="positionId"
                                        value={formData.positionId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-violet-200 dark:border-violet-800/30 bg-violet-50 dark:bg-violet-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-violet-500"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {hrmPositions.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <DollarSign size={12} /> Chính sách lương
                                    </label>
                                    <select
                                        name="salaryPolicyId"
                                        value={formData.salaryPolicyId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {hrmSalaryPolicies.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <Calendar size={12} /> Lịch làm việc
                                    </label>
                                    <select
                                        name="workScheduleId"
                                        value={formData.workScheduleId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {hrmWorkSchedules.map(w => (<option key={w.id} value={w.id}>{w.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tình trạng hôn nhân</label>
                                    <select
                                        name="maritalStatus"
                                        value={formData.maritalStatus || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        <option value="Độc thân">Độc thân</option>
                                        <option value="Đã kết hôn">Đã kết hôn</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* ===== ACCOUNT LINKING ===== */}
                        <div className="border-t border-slate-100 dark:border-slate-800 pt-6 mt-6">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider text-purple-600 dark:text-purple-400">
                                Liên kết Tài khoản phần mềm (WMS)
                            </label>
                            <p className="text-[10px] text-slate-400 mb-2">
                                Chọn 1 tài khoản đăng nhập để theo dõi lịch sử giao dịch kho của nhân sự này.
                            </p>
                            <select
                                name="userId"
                                value={formData.userId || ''}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-purple-200 dark:border-purple-800/30 bg-purple-50 dark:bg-purple-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">-- Không liên kết --</option>
                                {availableUsers.map(u => (
                                    <option key={u.id} value={u.id}>
                                        {u.name} ({u.email}) - Role: {u.role}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </form>
                </div>

                <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end space-x-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-3 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        form="employee-form"
                        className="px-6 py-3 rounded-xl bg-accent hover:bg-blue-700 text-white font-bold flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
                    >
                        <Save size={18} />
                        <span>Lưu Thông Tin</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmployeeModal;
