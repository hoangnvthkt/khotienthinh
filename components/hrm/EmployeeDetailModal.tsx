import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Employee, AssetStatus, ASSET_STATUS_LABELS, Asset } from '../../types';
import { X, User as UserIcon, Briefcase, Phone, Edit2, Calendar, MapPin, Building, Heart, Landmark } from 'lucide-react';

interface EmployeeDetailModalProps {
    employee: Employee;
    onClose: () => void;
    onEdit: (emp: Employee) => void;
}

type TabKey = 'personal' | 'work' | 'contact' | 'assets';

const EmployeeDetailModal: React.FC<EmployeeDetailModalProps> = ({ employee, onClose, onEdit }) => {
    const { users, hrmAreas, hrmOffices, hrmEmployeeTypes, hrmPositions, hrmSalaryPolicies, hrmWorkSchedules, hrmConstructionSites, orgUnits, assets, assetAssignments, assetCategories } = useApp();
    const [activeTab, setActiveTab] = useState<TabKey>('personal');

    const linkedUser = users.find(u => u.id === employee.userId);
    const area = hrmAreas.find(a => a.id === employee.areaId);
    const office = hrmOffices.find(o => o.id === employee.officeId);
    const position = hrmPositions.find(p => p.id === employee.positionId);
    const empType = hrmEmployeeTypes.find(t => t.id === employee.employeeTypeId);
    const salaryPolicy = hrmSalaryPolicies.find(s => s.id === employee.salaryPolicyId);
    const workSchedule = hrmWorkSchedules.find(w => w.id === employee.workScheduleId);
    const constructionSite = hrmConstructionSites.find(cs => cs.id === employee.constructionSiteId);
    const department = orgUnits.find(u => u.id === employee.departmentId);
    const factory = orgUnits.find(u => u.id === employee.factoryId);

    const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
        { key: 'personal', label: 'Cá Nhân', icon: <UserIcon size={15} /> },
        { key: 'work', label: 'Công Việc', icon: <Briefcase size={15} /> },
        { key: 'contact', label: 'Liên Hệ', icon: <Phone size={15} /> },
        { key: 'assets', label: 'Tài Sản', icon: <Landmark size={15} /> },
    ];

    // Assets assigned to this employee (match via userId)
    const employeeAssets = useMemo(() => {
        return assets.filter(a => a.assignedToUserId === employee.userId && a.status === AssetStatus.IN_USE);
    }, [assets, employee.userId]);

    const employeeAssetHistory = useMemo(() => {
        return assetAssignments.filter(a => a.userId === employee.userId);
    }, [assetAssignments, employee.userId]);

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || '';

    const InfoRow: React.FC<{ label: string; value?: string | null; badge?: boolean; badgeColor?: string }> = ({ label, value, badge, badgeColor }) => (
        <div className="flex items-start py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 w-36 shrink-0 pt-0.5">{label}</span>
            {badge && value ? (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${badgeColor || 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                    {value}
                </span>
            ) : (
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{value || <span className="text-slate-400 italic">--</span>}</span>
            )}
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-4">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl font-black shadow-lg shadow-blue-500/20">
                                {employee.fullName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-slate-800 dark:text-white tracking-tight">{employee.fullName}</h2>
                                <div className="flex items-center space-x-2 mt-1">
                                    <span className="text-xs font-bold text-accent bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md">{employee.employeeCode}</span>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${employee.status === 'Đang làm việc' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                                        {employee.status}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-100 dark:border-slate-800 px-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center space-x-1.5 px-4 py-3 text-xs font-bold uppercase tracking-wider transition border-b-2 -mb-px ${activeTab === tab.key
                                ? 'border-accent text-accent'
                                : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {activeTab === 'personal' && (
                        <div>
                            <InfoRow label="Họ & Tên" value={employee.fullName} />
                            <InfoRow label="Giới tính" value={employee.gender} />
                            <InfoRow label="Ngày sinh" value={employee.dateOfBirth} />
                            <InfoRow label="Tình trạng HN" value={employee.maritalStatus} />
                            <InfoRow label="Chức danh" value={employee.title} />
                            {linkedUser && (
                                <InfoRow label="Tài khoản" value={`${linkedUser.name} (${linkedUser.email})`} />
                            )}
                        </div>
                    )}

                    {activeTab === 'work' && (
                        <div>
                            <InfoRow label="Khu vực" value={area?.name} badge badgeColor="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" />
                            <InfoRow label="Văn phòng" value={office?.name} badge badgeColor="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" />
                            <InfoRow label="Vị trí" value={position?.name} badge badgeColor="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" />
                            <InfoRow label="Loại NV" value={empType?.name} />
                            <InfoRow label="Chính sách lương" value={salaryPolicy?.name} />
                            <InfoRow label="Lịch làm việc" value={workSchedule?.name} />
                            <InfoRow label="Công trường" value={constructionSite?.name} badge badgeColor="bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" />
                            <InfoRow label="Phòng / Ban" value={department?.name} badge badgeColor="bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400" />
                            <InfoRow label="Nhà máy" value={factory?.name} badge badgeColor="bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" />
                            <InfoRow label="Ngày vào" value={employee.startDate} />
                            <InfoRow label="Ngày chính thức" value={employee.officialDate} />
                        </div>
                    )}

                    {activeTab === 'contact' && (
                        <div>
                            <InfoRow label="Số điện thoại" value={employee.phone} />
                            <InfoRow label="Email" value={employee.email} />
                        </div>
                    )}

                    {activeTab === 'assets' && (
                        <div className="space-y-4">
                            {/* Currently assigned assets */}
                            <div>
                                <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Landmark size={12} /> Tài sản đang sử dụng ({employeeAssets.length})
                                </h4>
                                {employeeAssets.length === 0 ? (
                                    <div className="text-center py-6 text-slate-300 dark:text-slate-600 text-sm italic">Chưa được cấp phát tài sản nào</div>
                                ) : (
                                    <div className="space-y-2">
                                        {employeeAssets.map(asset => (
                                            <div key={asset.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center text-white shrink-0">
                                                    <Landmark size={14} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-black text-slate-800 dark:text-white truncate">{asset.name}</div>
                                                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                                        <span className="font-mono font-bold">{asset.code}</span>
                                                        <span>•</span>
                                                        <span>{getCategoryName(asset.categoryId)}</span>
                                                        {asset.brand && <><span>•</span><span>{asset.brand} {asset.model || ''}</span></>}
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className="text-xs font-black text-slate-700 dark:text-slate-300">{asset.originalValue.toLocaleString('vi-VN')}đ</div>
                                                    {asset.assignedDate && <div className="text-[9px] text-slate-400">từ {new Date(asset.assignedDate).toLocaleDateString('vi-VN')}</div>}
                                                </div>
                                            </div>
                                        ))}
                                        <div className="text-right text-xs font-black text-rose-600 pt-1">
                                            Tổng giá trị: {employeeAssets.reduce((s, a) => s + a.originalValue, 0).toLocaleString('vi-VN')}đ
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Assignment history */}
                            {employeeAssetHistory.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Lịch sử cấp phát / thu hồi</h4>
                                    <div className="space-y-1">
                                        {employeeAssetHistory.map(record => {
                                            const asset = assets.find(a => a.id === record.assetId);
                                            const isAssign = record.type === 'assign';
                                            return (
                                                <div key={record.id} className="flex items-center gap-2 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${isAssign ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'}`}>
                                                        {isAssign ? 'Nhận' : 'Trả'}
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{asset?.name || record.assetId}</span>
                                                    <span className="text-[10px] text-slate-400 ml-auto shrink-0">{new Date(record.date).toLocaleDateString('vi-VN')}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end items-center gap-3 p-5 border-t border-slate-100 dark:border-slate-800">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                        Đóng
                    </button>
                    <button
                        onClick={() => { onClose(); onEdit(employee); }}
                        className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-accent hover:bg-blue-700 text-white text-sm font-bold transition shadow-lg hover:shadow-blue-500/30"
                    >
                        <Edit2 size={15} />
                        <span>Sửa</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmployeeDetailModal;
