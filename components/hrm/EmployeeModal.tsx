import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Employee, LeaveBalance } from '../../types';
import { X, Save, User as UserIcon, Building, Layers, HardHat, DollarSign, Calendar, Factory, FolderTree, CalendarDays, Camera, Loader2, GitBranch, GraduationCap, HeartPulse } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

interface EmployeeModalProps {
    employee: Employee | null;
    onClose: () => void;
    mode?: 'admin' | 'self';
    onSelfUpdate?: (employee: Employee) => Promise<void>;
}

const EmployeeModal: React.FC<EmployeeModalProps> = ({ employee, onClose, mode = 'admin', onSelfUpdate }) => {
    const { addEmployee, updateEmployee, users, employees, warehouses, hrmOffices, hrmEmployeeTypes, hrmPositions, hrmSalaryPolicies, hrmWorkSchedules, hrmConstructionSites, orgUnits, leaveBalances, getHrmCatalogItems, addHrmItem, updateHrmItem } = useApp();
    const toast = useToast();
    const isSelfMode = mode === 'self';
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
	        employmentStatusId: undefined,
	        educationLevelId: undefined,
	        socialInsuranceStatusId: undefined,
        userId: undefined,

        officeId: undefined,
        employeeTypeId: undefined,
        positionId: undefined,
        salaryPolicyId: undefined,
        workScheduleId: undefined,
        constructionSiteId: undefined,
        departmentId: undefined,
        factoryId: undefined,
        orgUnitId: undefined,
        maritalStatus: '',
        avatarUrl: ''
    });
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
	    const [saving, setSaving] = useState(false);
	    const fileInputRef = useRef<HTMLInputElement>(null);
	    const employmentStatuses = useMemo(() => getHrmCatalogItems('employment_status'), [getHrmCatalogItems]);
	    const educationLevels = useMemo(() => getHrmCatalogItems('education_level'), [getHrmCatalogItems]);
	    const socialInsuranceStatuses = useMemo(() => getHrmCatalogItems('social_insurance_status'), [getHrmCatalogItems]);

	    useEffect(() => {
	        if (employee) {
	            setFormData(employee);
	            setAvatarPreview(employee.avatarUrl || null);
	        }
	    }, [employee]);

	    useEffect(() => {
	        if (employee || formData.employmentStatusId || employmentStatuses.length === 0) return;
	        const defaultStatus = employmentStatuses.find(item => item.code === 'DL') || employmentStatuses[0];
	        setFormData(prev => ({
	            ...prev,
	            employmentStatusId: defaultStatus.id,
	            status: defaultStatus.code === 'NV' ? 'Đã nghỉ việc' : 'Đang làm việc',
	        }));
	    }, [employee, employmentStatuses, formData.employmentStatusId]);

    const handleAvatarUpload = async (file: File) => {
        if (file.size > 2 * 1024 * 1024) {
            toast.warning('Ảnh quá lớn', 'Dung lượng tối đa là 2MB.');
            return;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            toast.warning('File không hợp lệ', 'Chỉ chấp nhận JPG, PNG hoặc WEBP.');
            return;
        }
        setUploadingAvatar(true);
        try {
            const ext = file.name.split('.').pop();
            const path = `employees/${formData.id || crypto.randomUUID()}_${Date.now()}.${ext}`;
            const { error } = await supabase.storage.from('avatars').upload(path, file, { cacheControl: '3600', upsert: true });
            if (error) throw error;
            const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
            const url = urlData.publicUrl;
            setAvatarPreview(url);
            setFormData(prev => ({ ...prev, avatarUrl: url }));
            toast.success('Đã tải ảnh đại diện');
        } catch (err: any) {
            logApiError('employeeModal.avatarUpload', err);
            toast.error('Không thể tải ảnh đại diện', getApiErrorMessage(err, 'Không thể upload ảnh lên Supabase Storage.'));
        } finally {
            setUploadingAvatar(false);
        }
    };

    // Leave balance state
    const currentYear = new Date().getFullYear();
    const existingBalance = employee ? leaveBalances.find(b => b.employeeId === employee.id && b.year === currentYear) : null;
    const [initialDays, setInitialDays] = useState<number>(12);
    const [remainingDays, setRemainingDays] = useState<number>(0);

    useEffect(() => {
        if (existingBalance) {
            setInitialDays(existingBalance.initialDays);
            setRemainingDays(existingBalance.accruedDays - existingBalance.usedPaidDays);
        }
    }, [existingBalance]);

    // Tìm các users chưa được gán cho nhân sự nào (ngoại trừ user đang được gán cho nhân sự hiện tại)
    const availableUsers = users.filter(usr => {
        const isLinkedToOther = employees.some(emp => emp.userId === usr.id && emp.id !== employee?.id);
        return !isLinkedToOther;
    });

	    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
	        const { name, value } = e.target;
	        setFormData(prev => ({ ...prev, [name]: value }));
	    };

	    const handleEmploymentStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
	        const value = e.target.value || undefined;
	        const selected = employmentStatuses.find(item => item.id === value);
	        setFormData(prev => ({
	            ...prev,
	            employmentStatusId: value,
	            status: selected?.code === 'NV' ? 'Đã nghỉ việc' : 'Đang làm việc',
	        }));
	    };

    const handleLinkedUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const userId = e.target.value || undefined;
        const linkedUser = users.find(u => u.id === userId);
        if (!linkedUser) {
            setFormData(prev => ({ ...prev, userId }));
            return;
        }

        setFormData(prev => ({
            ...prev,
            userId,
            fullName: linkedUser.name || prev.fullName,
            email: linkedUser.email || prev.email,
            phone: linkedUser.phone || prev.phone,
            avatarUrl: linkedUser.avatar || prev.avatarUrl,
        }));
        if (linkedUser.avatar) setAvatarPreview(linkedUser.avatar);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.fullName) {
            toast.warning('Thiếu họ tên', 'Vui lòng nhập họ tên nhân sự.');
            return;
        }

        setSaving(true);
        try {
            if (isSelfMode) {
                if (!employee?.id || !onSelfUpdate) {
                    throw new Error('Không tìm thấy hồ sơ cá nhân để cập nhật.');
                }
                await onSelfUpdate(formData as Employee);
                toast.success('Đã cập nhật thông tin cá nhân');
                onClose();
                return;
            }

            if (employee && employee.id) {
                await updateEmployee(formData as Employee);
            } else {
                const newEmployee: Employee = {
                    ...formData,
                    id: crypto.randomUUID(), // Temp ID, will be overwritten by Supabase Realtime if necessary or respected
                    employeeCode: '', // Leave empty to let Supabase Sequence trigger
                } as Employee;
                await addEmployee(newEmployee);
                // Tạo leave balance cho nhân sự mới
                const currentMonth = new Date().getMonth() + 1;
                const newBalance: LeaveBalance = {
                    id: crypto.randomUUID(),
                    employeeId: newEmployee.id,
                    year: currentYear,
                    initialDays: initialDays,
                    monthlyAccrual: 1,
                    accruedDays: currentMonth, // Cộng dồn cho các tháng đã qua
                    usedPaidDays: 0,
                    usedUnpaidDays: 0,
                    lastAccrualMonth: currentMonth,
                };
                addHrmItem('hrm_leave_balances', newBalance);
            }

            // Cập nhật leave balance nếu initialDays hoặc remainingDays thay đổi
            if (employee && existingBalance) {
                const newAccruedDays = remainingDays + existingBalance.usedPaidDays;
                const hasChanges = existingBalance.initialDays !== initialDays || existingBalance.accruedDays !== newAccruedDays;
                if (hasChanges) {
                    updateHrmItem('hrm_leave_balances', { ...existingBalance, initialDays, accruedDays: newAccruedDays });
                }
            } else if (employee && !existingBalance) {
                // Tạo mới balance nếu chưa có
                const currentMonth = new Date().getMonth() + 1;
                const newBalance: LeaveBalance = {
                    id: crypto.randomUUID(),
                    employeeId: employee.id,
                    year: currentYear,
                    initialDays: initialDays,
                    monthlyAccrual: 1,
                    accruedDays: currentMonth,
                    usedPaidDays: 0,
                    usedUnpaidDays: 0,
                    lastAccrualMonth: currentMonth,
                };
                addHrmItem('hrm_leave_balances', newBalance);
            }
            toast.success(employee ? 'Đã cập nhật hồ sơ nhân sự' : 'Đã thêm hồ sơ nhân sự');
            onClose();
        } catch (err: any) {
            logApiError('employeeModal.save', err);
            toast.error('Không thể lưu hồ sơ nhân sự', getApiErrorMessage(err, 'Không thể lưu hồ sơ nhân sự trên Supabase.'));
        } finally {
            setSaving(false);
        }
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
                                {isSelfMode ? 'Sửa Thông Tin Cá Nhân' : employee ? 'Sửa Hồ Sơ Nhân Sự' : 'Thêm Nhân Sự Mới'}
                            </h2>
                            <p className="text-xs text-slate-500 font-medium">{isSelfMode ? 'Cập nhật thông tin liên hệ và ảnh đại diện của anh' : 'Bổ sung hoặc cập nhật thông tin nhân viên'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={saving} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-all disabled:opacity-60">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <form id="employee-form" onSubmit={handleSubmit} className="space-y-6">
                        {/* ===== AVATAR UPLOAD ===== */}
                        <div className="flex flex-col items-center gap-3">
                            <div
                                onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
                                className={`relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 transition-all group bg-slate-100 dark:bg-slate-800 ${uploadingAvatar ? 'cursor-wait opacity-80' : 'cursor-pointer'}`}
                            >
                                {avatarPreview ? (
                                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                                        <UserIcon size={32} />
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    {uploadingAvatar ? <Loader2 size={20} className="text-white animate-spin" /> : <Camera size={20} className="text-white" />}
                                </div>
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingAvatar} onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); }} />
                            <p className="text-[10px] text-slate-400">Click để tải ảnh đại diện (JPG, PNG, WEBP ≤ 2MB)</p>
                        </div>
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

                            {!isSelfMode && (
                                <div className="space-y-2">
	                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Chức danh ghi chú</label>
                                    <input
                                        type="text"
                                        name="title"
                                        value={formData.title || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
	                                        placeholder="Tên hiển thị phụ, không thay thế VTCV"
                                    />
                                </div>
                            )}
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

                            {isSelfMode && (
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
                            )}

                            {!isSelfMode && (
                                <>
	                                    <div className="space-y-2">
	                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tình Trạng</label>
	                                        {employmentStatuses.length > 0 ? (
	                                            <select
	                                                name="employmentStatusId"
	                                                value={formData.employmentStatusId || ''}
	                                                onChange={handleEmploymentStatusChange}
	                                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
	                                            >
	                                                <option value="">-- Vui lòng chọn --</option>
	                                                {employmentStatuses.map(item => (
	                                                    <option key={item.id} value={item.id}>{item.code} - {item.name}</option>
	                                                ))}
	                                            </select>
	                                        ) : (
	                                            <select
	                                                name="status"
	                                                value={formData.status}
	                                                onChange={handleChange}
	                                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
	                                            >
	                                                <option value="Đang làm việc">Đang làm việc</option>
	                                                <option value="Đã nghỉ việc">Đã nghỉ việc</option>
	                                            </select>
	                                        )}
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
                                </>
                            )}
                        </div>

                        {/* ===== HRM MASTER DATA SECTION ===== */}
                        {!isSelfMode && <div className="border-t border-slate-100 dark:border-slate-800 pt-6 mt-6">
                            <h3 className="text-sm font-black text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Layers size={16} /> Thông tin chính
                            </h3>
                            <p className="text-[10px] text-slate-400 mb-4">Chọn thông tin từ dữ liệu gốc HRM đã khai báo trong Cài đặt.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
	                                        <GraduationCap size={12} /> Trình độ
	                                    </label>
	                                    <select
	                                        name="educationLevelId"
	                                        value={formData.educationLevelId || ''}
	                                        onChange={handleChange}
	                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
	                                    >
	                                        <option value="">-- Vui lòng chọn --</option>
	                                        {educationLevels.map(item => (<option key={item.id} value={item.id}>{item.code} - {item.name}</option>))}
	                                    </select>
	                                </div>
	                                <div className="space-y-2">
	                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
	                                        <HeartPulse size={12} /> BHXH
	                                    </label>
	                                    <select
	                                        name="socialInsuranceStatusId"
	                                        value={formData.socialInsuranceStatusId || ''}
	                                        onChange={handleChange}
	                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-accent"
	                                    >
	                                        <option value="">-- Vui lòng chọn --</option>
	                                        {socialInsuranceStatuses.map(item => (<option key={item.id} value={item.id}>{item.code} - {item.name}</option>))}
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
	                                        {hrmPositions
	                                            .filter(p => p.isActive !== false)
	                                            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'vi'))
	                                            .map(p => (<option key={p.id} value={p.id}>{p.code ? `${p.code} - ` : ''}{p.name}</option>))}
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
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <GitBranch size={12} /> Đơn vị trực thuộc (Sơ đồ tổ chức) *
                                    </label>
                                    <select
                                        name="orgUnitId"
                                        required
                                        value={formData.orgUnitId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-indigo-200 dark:border-indigo-800/30 bg-indigo-50 dark:bg-indigo-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 font-bold"
                                    >
                                        <option value="">-- Chọn đơn vị --</option>
                                        {orgUnits.map(u => (<option key={u.id} value={u.id}>{u.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <FolderTree size={12} /> Phòng / Ban
                                    </label>
                                    <select
                                        name="departmentId"
                                        value={formData.departmentId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-sky-200 dark:border-sky-800/30 bg-sky-50 dark:bg-sky-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-sky-500"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {orgUnits.filter(u => u.type === 'department').map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <HardHat size={12} /> Công trường
                                    </label>
                                    <select
                                        name="constructionSiteId"
                                        value={formData.constructionSiteId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-orange-200 dark:border-orange-800/30 bg-orange-50 dark:bg-orange-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-orange-500"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {[...hrmConstructionSites.map(cs => ({ id: cs.id, name: cs.name })), ...orgUnits.filter(u => u.type === 'construction_site').filter(u => !hrmConstructionSites.find(cs => cs.name === u.name)).map(u => ({ id: u.id, name: u.name }))].map(cs => (<option key={cs.id} value={cs.id}>{cs.name}</option>))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                        <Factory size={12} /> Nhà máy
                                    </label>
                                    <select
                                        name="factoryId"
                                        value={formData.factoryId || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-purple-200 dark:border-purple-800/30 bg-purple-50 dark:bg-purple-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-purple-500"
                                    >
                                        <option value="">-- Vui lòng chọn --</option>
                                        {orgUnits.filter(u => u.type === 'factory').map(f => (<option key={f.id} value={f.id}>{f.name}</option>))}
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
                        </div>}

                        {/* ===== NGÀY PHÉP NĂM ===== */}
                        {!isSelfMode && <div className="border-t border-slate-100 dark:border-slate-800 pt-6 mt-6">
                            <h3 className="text-sm font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <CalendarDays size={16} /> Quản lý ngày phép ({currentYear})
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng phép năm (ngày)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={365}
                                        value={initialDays}
                                        onChange={e => setInitialDays(Math.max(0, parseInt(e.target.value) || 0))}
                                        className="w-full px-4 py-3 rounded-xl border border-emerald-200 dark:border-emerald-800/30 bg-emerald-50 dark:bg-emerald-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-emerald-500 font-bold"
                                    />
                                </div>
                                {existingBalance && (
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Phép còn lại (ngày)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={365}
                                            value={remainingDays}
                                            onChange={e => setRemainingDays(Math.max(0, parseFloat(e.target.value) || 0))}
                                            className={`w-full px-4 py-3 rounded-xl border text-sm font-bold focus:ring-2 ${
                                                remainingDays <= 0
                                                    ? 'border-red-200 dark:border-red-800/30 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 focus:ring-red-500'
                                                    : 'border-emerald-200 dark:border-emerald-800/30 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400 focus:ring-emerald-500'
                                            }`}
                                        />
                                        <p className="text-[10px] text-slate-400">Tích lũy hàng tháng. Reset về 0 sau tháng 3 năm kế tiếp.</p>
                                    </div>
                                )}
                            </div>
                        </div>}

                        {/* ===== ACCOUNT LINKING ===== */}
                        {!isSelfMode && <div className="border-t border-slate-100 dark:border-slate-800 pt-6 mt-6">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider text-purple-600 dark:text-purple-400">
                                Liên kết tài khoản hệ thống / kho (nếu có)
                            </label>
                            <p className="text-[10px] text-slate-400 mb-2">
                                Chọn tài khoản đăng nhập để lấy sẵn họ tên, email, SĐT và liên kết lịch sử thao tác phần mềm.
                            </p>
                            <select
                                name="userId"
                                value={formData.userId || ''}
                                onChange={handleLinkedUserChange}
                                className="w-full px-4 py-3 rounded-xl border border-purple-200 dark:border-purple-800/30 bg-purple-50 dark:bg-purple-900/10 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">-- Không liên kết --</option>
                                {availableUsers.map(u => {
                                    const assignedWarehouse = warehouses.find(w => w.id === u.assignedWarehouseId);
                                    const warehouseLabel = assignedWarehouse ? ` - Kho: ${assignedWarehouse.name}` : '';
                                    return (
                                        <option key={u.id} value={u.id}>
                                            {u.name} ({u.email}) - Role: {u.role}{warehouseLabel}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>}
                    </form>
                </div>

                <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end space-x-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-6 py-3 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        form="employee-form"
                        disabled={saving}
                        className="px-6 py-3 rounded-xl bg-accent hover:bg-blue-700 text-white font-bold flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all disabled:opacity-60"
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        <span>{saving ? 'Đang lưu...' : 'Lưu Thông Tin'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmployeeModal;
