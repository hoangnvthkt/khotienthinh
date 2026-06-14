import React, { useRef, useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { Employee, LeaveBalance } from '../../types';
import { Plus, Search, Edit2, Trash2, Phone, Mail, MapPin, Building, Briefcase, Users, LayoutGrid, List, User as UserIcon, Upload, Download, Loader2, RefreshCcw } from 'lucide-react';
import EmployeeModal from '../../components/hrm/EmployeeModal';
import EmployeeDetailModal from '../../components/hrm/EmployeeDetailModal';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import Pagination from '../../components/Pagination';
import { usePagination } from '../../hooks/usePagination';
import { usePermission } from '../../hooks/usePermission';
import { loadXlsx } from '../../lib/loadXlsx';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import ExcelImportReviewModal from '../../components/ExcelImportReviewModal';
import { ExcelImportMode, ExcelImportPreview, applyImportChanges, buildImportPreview, parseExcelRows } from '../../lib/excelImport';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import { employeeSelfService } from '../../lib/employeeSelfService';

const Employees: React.FC = () => {
    const { employees, users, addEmployee, updateEmployee, replaceEmployeeLocal, removeEmployee, addHrmItem, hrmAreas, hrmOffices, hrmPositions, hrmConstructionSites, orgUnits, user, setUser } = useApp();
    const { canManage } = usePermission();
    const canCRUD = canManage('/hrm/employees');
    useModuleData('hrm');
    const toast = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
    const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
    const [importing, setImporting] = useState(false);
    const [importMode, setImportMode] = useState<ExcelImportMode>('create');
    const [importPreview, setImportPreview] = useState<ExcelImportPreview<Employee> | null>(null);
    const [deleting, setDeleting] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const importModeRef = useRef<ExcelImportMode>('create');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
        return (localStorage.getItem('emp_view_mode') as 'grid' | 'table') || 'grid';
    });

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp =>
            !searchTerm.trim() || matchesSearchQueryMultiple([
                emp.fullName,
                emp.employeeCode,
                emp.phone
            ], searchTerm)
        );
    }, [employees, searchTerm]);

    const { paginatedItems: paginatedEmployees, currentPage, totalPages, totalItems, pageSize, setPage, setPageSize, startIndex, endIndex } = usePagination<Employee>(filteredEmployees, 20);

    const isSelfEmployee = (emp: Employee) => Boolean(user?.id && emp.userId === user.id);
    const canEditEmployee = (emp: Employee) => canCRUD || isSelfEmployee(emp);
    const showActions = canCRUD || paginatedEmployees.some(isSelfEmployee);

    const handleEdit = (emp: Employee) => {
        if (!canEditEmployee(emp)) return;
        setEditingEmployee(emp);
        setIsModalOpen(true);
    };
    const handleAdd = () => { setEditingEmployee(null); setIsModalOpen(true); };
    const handleView = (emp: Employee) => { setViewingEmployee(emp); };
    const handleDelete = (emp: Employee) => {
        setDeletingEmployee(emp);
    };
    const handleConfirmDelete = async () => {
        if (deletingEmployee) {
            setDeleting(true);
            try {
                await removeEmployee(deletingEmployee.id);
                toast.success('Đã xoá hồ sơ nhân sự', deletingEmployee.fullName);
                setDeletingEmployee(null);
            } catch (err: any) {
                logApiError('employees.delete', err);
                toast.error('Không thể xoá hồ sơ nhân sự', getApiErrorMessage(err, 'Không thể xoá hồ sơ nhân sự trên Supabase.'));
            } finally {
                setDeleting(false);
            }
        }
    };
    const handleSelfEmployeeUpdate = async (nextEmployee: Employee) => {
        const patch = {
            fullName: nextEmployee.fullName,
            gender: nextEmployee.gender,
            dateOfBirth: nextEmployee.dateOfBirth,
            maritalStatus: nextEmployee.maritalStatus,
            phone: nextEmployee.phone,
            email: nextEmployee.email,
            avatarUrl: nextEmployee.avatarUrl,
        };

        const updatedEmployee = await employeeSelfService.updateMyProfile(patch);
        if (updatedEmployee) {
            replaceEmployeeLocal(updatedEmployee);
            setUser({
                ...user,
                name: updatedEmployee.fullName || user.name,
                phone: updatedEmployee.phone,
                avatar: updatedEmployee.avatarUrl || user.avatar,
            });
            return;
        }

        await updateEmployee(nextEmployee);
        setUser({
            ...user,
            name: nextEmployee.fullName || user.name,
            phone: nextEmployee.phone,
            avatar: nextEmployee.avatarUrl || user.avatar,
        });
    };
    const toggleView = (mode: 'grid' | 'table') => {
        setViewMode(mode);
        localStorage.setItem('emp_view_mode', mode);
    };

    const activeCount = employees.filter(e => e.status === 'Đang làm việc').length;

    const pick = (row: Record<string, any>, keys: string[]) => {
        for (const key of keys) {
            const value = row[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
        }
        return '';
    };

    const normalizeDate = (value: string) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toISOString().slice(0, 10);
    };

    const normalizeGender = (value: string): Employee['gender'] => {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'nữ' || normalized === 'nu' || normalized === 'female') return 'Nữ';
        if (normalized === 'khác' || normalized === 'khac' || normalized === 'other') return 'Khác';
        return 'Nam';
    };

    const normalizeStatus = (value: string): Employee['status'] => {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'đã nghỉ việc' || normalized === 'da nghi viec' || normalized === 'nghỉ việc' || normalized === 'inactive') return 'Đã nghỉ việc';
        return 'Đang làm việc';
    };

    const findLinkedUser = (value: string) => {
        const accountKey = value.trim().toLowerCase();
        if (!accountKey) return undefined;
        return users.find(u =>
            u.id.toLowerCase() === accountKey ||
            u.username?.toLowerCase() === accountKey ||
            u.email.toLowerCase() === accountKey
        );
    };

    const openEmployeeImport = (mode: ExcelImportMode) => {
        importModeRef.current = mode;
        setImportMode(mode);
        importInputRef.current?.click();
    };

    const handleDownloadEmployeeTemplate = async () => {
        try {
            const XLSX = await loadXlsx();
            const createHeaders = [
                'Mã nhân sự *', 'Họ tên *', 'Chức danh', 'Giới tính', 'SĐT', 'Email',
                'Ngày sinh', 'Ngày vào làm', 'Ngày chính thức', 'Trạng thái', 'Tài khoản hệ thống',
            ];
            const createRows = [
                ['NS-001', 'Nguyễn Văn A', 'Kỹ sư hiện trường', 'Nam', '0900000000', 'a@example.com', '1990-01-01', '2026-05-01', '2026-07-01', 'Đang làm việc', ''],
            ];
            const updateHeaders = ['Mã nhân sự *', 'Chức danh', 'SĐT', 'Email', 'Trạng thái', 'Tài khoản hệ thống'];
            const updateRows = [['NS-001', 'Chỉ huy trưởng', '', '', '', '']];
            const guideRows = [
                ['Nội dung', 'Hướng dẫn'],
                ['Nhập mới', 'Dùng sheet Nhap_moi. Mã nhân sự đã tồn tại sẽ bị báo lỗi.'],
                ['Cập nhật', 'Dùng sheet Cap_nhat hoặc file chỉ gồm Mã nhân sự và các cột muốn sửa.'],
                ['Ô trống', 'Trong chế độ Cập nhật, ô trống nghĩa là không đổi dữ liệu.'],
                ['Xóa giá trị', 'Dùng token __CLEAR__ cho các cột cho phép xoá như email, SĐT, tài khoản hệ thống.'],
            ];
            const wb = XLSX.utils.book_new();
            const createWs = XLSX.utils.aoa_to_sheet([createHeaders, ...createRows]);
            createWs['!cols'] = createHeaders.map(() => ({ wch: 20 }));
            const updateWs = XLSX.utils.aoa_to_sheet([updateHeaders, ...updateRows]);
            updateWs['!cols'] = updateHeaders.map(() => ({ wch: 20 }));
            const guideWs = XLSX.utils.aoa_to_sheet(guideRows);
            guideWs['!cols'] = [{ wch: 18 }, { wch: 90 }];
            XLSX.utils.book_append_sheet(wb, createWs, 'Nhap_moi');
            XLSX.utils.book_append_sheet(wb, updateWs, 'Cap_nhat');
            XLSX.utils.book_append_sheet(wb, guideWs, 'Huong_dan');
            const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'Mau_import_nhan_su.xlsx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success('Đã tải file mẫu nhân sự');
        } catch (err) {
            logApiError('employees.template', err);
            toast.error('Không thể tạo file mẫu', getApiErrorMessage(err, 'Không thể tạo file Excel mẫu nhân sự.'));
        }
    };

    const buildEmployeePreview = (mode: ExcelImportMode, rows: Record<string, unknown>[]) => buildImportPreview<Employee>({
        mode,
        keyLabel: 'Mã nhân sự',
        keyAliases: ['Mã nhân sự *', 'Mã nhân sự', 'Mã NV', 'Ma NV', 'employeeCode', 'employee_code'],
        existingRecords: employees,
        getRecordKey: emp => emp.employeeCode,
        createBaseRecord: employeeCode => ({
            id: crypto.randomUUID(),
            employeeCode,
            fullName: '',
            title: '',
            gender: 'Nam',
            phone: '',
            email: '',
            status: 'Đang làm việc',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }),
        fields: [
            { key: 'fullName', label: 'Họ tên', aliases: ['Họ tên *', 'Họ tên', 'Ho ten', 'Họ và tên', 'Tên nhân sự', 'fullName'], requiredOnCreate: true },
            { key: 'title', label: 'Chức danh', aliases: ['Chức danh', 'Chuc danh', 'Vị trí', 'title'], clearable: true },
            { key: 'gender', label: 'Giới tính', aliases: ['Giới tính', 'Gioi tinh', 'gender'], normalize: value => normalizeGender(String(value)) },
            { key: 'phone', label: 'SĐT', aliases: ['SĐT', 'SDT', 'Số điện thoại', 'phone'], clearable: true },
            {
                key: 'email',
                label: 'Email',
                aliases: ['Email', 'email'],
                clearable: true,
                validate: (value, row) => {
                    const email = String(value || '').trim().toLowerCase();
                    if (!email) return undefined;
                    const code = pick(row, ['Mã nhân sự *', 'Mã nhân sự', 'Mã NV', 'Ma NV', 'employeeCode', 'employee_code']);
                    const owner = employees.find(emp => emp.email?.toLowerCase() === email && emp.employeeCode.toLowerCase() !== code.toLowerCase());
                    return owner ? `Email đang thuộc nhân sự ${owner.employeeCode}.` : undefined;
                },
            },
            { key: 'dateOfBirth', label: 'Ngày sinh', aliases: ['Ngày sinh', 'Ngay sinh', 'dateOfBirth'], clearable: true, normalize: value => normalizeDate(String(value)) },
            { key: 'startDate', label: 'Ngày vào làm', aliases: ['Ngày vào làm', 'Ngay vao lam', 'startDate'], clearable: true, normalize: value => normalizeDate(String(value)) },
            { key: 'officialDate', label: 'Ngày chính thức', aliases: ['Ngày chính thức', 'Ngay chinh thuc', 'officialDate'], clearable: true, normalize: value => normalizeDate(String(value)) },
            { key: 'status', label: 'Trạng thái', aliases: ['Trạng thái', 'Trang thai', 'status'], normalize: value => normalizeStatus(String(value)) },
            {
                key: 'userId',
                label: 'Tài khoản hệ thống',
                aliases: ['Tài khoản hệ thống', 'Tai khoan he thong', 'Tên đăng nhập', 'Email tài khoản', 'userEmail'],
                clearable: true,
                normalize: value => findLinkedUser(String(value))?.id,
                validate: (value, row) => {
                    const raw = pick(row, ['Tài khoản hệ thống', 'Tai khoan he thong', 'Tên đăng nhập', 'Email tài khoản', 'userEmail']);
                    return raw && !value ? `Không tìm thấy tài khoản hệ thống "${raw}".` : undefined;
                },
            },
        ],
    }, rows);

    const handleImportEmployees = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        setImporting(true);
        try {
            const rows = await parseExcelRows(file, importModeRef.current === 'create' ? 'Nhap_moi' : 'Cap_nhat');
            if (rows.length === 0) { toast.warning('File rỗng', 'File Excel không có dữ liệu nhân sự.'); return; }
            setImportPreview(buildEmployeePreview(importModeRef.current, rows));
        } catch (err: any) {
            logApiError('employees.import', err);
            toast.error('Không thể đọc file nhân sự', getApiErrorMessage(err, 'Không thể đọc file Excel nhân sự.'));
        } finally {
            setImporting(false);
        }
    };

    const handleConfirmEmployeeImport = async () => {
        if (!importPreview) return;
        setImporting(true);
        try {
            const records = applyImportChanges(importPreview);
            if (records.length === 0) {
                toast.warning('Không có thay đổi', 'File không có dòng hợp lệ cần ghi dữ liệu.');
                return;
            }
            const currentYear = new Date().getFullYear();
            const currentMonth = new Date().getMonth() + 1;
            if (importPreview.mode === 'create') {
                for (const record of records) {
                    const linkedUser = record.userId ? users.find(u => u.id === record.userId) : undefined;
                    const employee: Employee = {
                        ...record,
                        avatarUrl: record.avatarUrl || linkedUser?.avatar,
                        updatedAt: new Date().toISOString(),
                    };
                    await addEmployee(employee);
                    addHrmItem('hrm_leave_balances', {
                        id: crypto.randomUUID(),
                        employeeId: employee.id,
                        year: currentYear,
                        initialDays: 12,
                        monthlyAccrual: 1,
                        accruedDays: currentMonth,
                        usedPaidDays: 0,
                        usedUnpaidDays: 0,
                        lastAccrualMonth: currentMonth,
                    } as LeaveBalance);
                }
                toast.success('Import nhân sự thành công', `${records.length} hồ sơ đã được thêm.`);
            } else {
                const changedRows = importPreview.rows.filter(row => row.status === 'update' && row.existingRecord && row.nextRecord);
                for (const row of changedRows) {
                    await updateEmployee({ ...row.existingRecord!, ...row.nextRecord!, updatedAt: new Date().toISOString() });
                }
                toast.success('Cập nhật nhân sự thành công', `${changedRows.length} hồ sơ đã được cập nhật.`);
            }
            setImportPreview(null);
        } catch (err: any) {
            logApiError('employees.import.apply', err);
            toast.error('Không thể ghi dữ liệu nhân sự', getApiErrorMessage(err, 'Không thể ghi dữ liệu nhân sự lên Supabase.'));
        } finally {
            setImporting(false);
        }
    };

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
                        <>
                            <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportEmployees} className="hidden" />
                            <button
                                onClick={handleDownloadEmployeeTemplate}
                                disabled={importing}
                                className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-3 py-2.5 rounded-xl transition-all hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-bold justify-center disabled:opacity-60"
                            >
                                <Download size={16} />
                                <span>Mẫu</span>
                            </button>
                            <button
                                onClick={() => openEmployeeImport('create')}
                                disabled={importing}
                                className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl transition-all hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-bold justify-center disabled:opacity-60"
                            >
                                {importing && importMode === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                <span>Nhập mới</span>
                            </button>
                            <button
                                onClick={() => openEmployeeImport('update')}
                                disabled={importing}
                                className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900/60 text-amber-700 dark:text-amber-300 px-4 py-2.5 rounded-xl transition-all hover:bg-amber-50 dark:hover:bg-amber-900/20 text-sm font-bold justify-center disabled:opacity-60"
                            >
                                {importing && importMode === 'update' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                                <span>Cập nhật</span>
                            </button>
                            <button onClick={handleAdd} className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/30 text-sm font-bold flex-1 sm:flex-initial justify-center">
                                <Plus size={18} />
                                <span>Thêm Mới</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {importPreview && (
                <ExcelImportReviewModal
                    title={importPreview.mode === 'create' ? 'Preview nhập mới nhân sự' : 'Preview cập nhật nhân sự'}
                    preview={importPreview}
                    loading={importing}
                    onClose={() => setImportPreview(null)}
                    onConfirm={handleConfirmEmployeeImport}
                />
            )}

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

                                        {/* Actions hover */}
                                        {canEditEmployee(emp) && (
                                            <div className="absolute top-1 right-1 flex gap-px opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={(e) => { e.stopPropagation(); handleEdit(emp); }} className="p-0.5 text-slate-300 hover:text-indigo-500 rounded transition-all" title="Sửa"><Edit2 size={9} /></button>
                                                {canCRUD && <button onClick={(e) => { e.stopPropagation(); handleDelete(emp); }} className="p-0.5 text-slate-300 hover:text-red-500 rounded transition-all" title="Xóa"><Trash2 size={9} /></button>}
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
                                    {showActions && <th className="py-3 px-4 border-b border-slate-200/60 dark:border-slate-700/50 text-center w-[80px]">Thao Tác</th>}
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
                                            {showActions && (
                                                <td className="py-2.5 px-4 text-center">
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        {canEditEmployee(emp) && <button onClick={(e) => { e.stopPropagation(); handleEdit(emp); }} className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-all" title="Sửa"><Edit2 size={14} /></button>}
                                                        {canCRUD && <button onClick={(e) => { e.stopPropagation(); handleDelete(emp); }} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all" title="Xóa"><Trash2 size={14} /></button>}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                                {filteredEmployees.length === 0 && (
                                    <tr><td colSpan={showActions ? 10 : 9} className="py-16 text-center"><Users size={40} className="mx-auto mb-3 text-slate-200 dark:text-slate-700" /><p className="text-sm font-bold text-slate-400">Chưa có nhân sự nào</p></td></tr>
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

            {isModalOpen && (
                <EmployeeModal
                    employee={editingEmployee}
                    mode={editingEmployee && !canCRUD && isSelfEmployee(editingEmployee) ? 'self' : 'admin'}
                    onSelfUpdate={handleSelfEmployeeUpdate}
                    onClose={() => setIsModalOpen(false)}
                />
            )}
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
                isDeleting={deleting}
            />
        </div>
    );
};

export default Employees;
