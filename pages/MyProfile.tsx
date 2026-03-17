import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Employee, AssetStatus, Asset } from '../types';
import {
    User as UserIcon, Briefcase, Phone, Calendar, MapPin, Building,
    Heart, Landmark, Mail, Shield, Clock, Award, ChevronRight,
    Settings, Package, FileText, Hash
} from 'lucide-react';

type TabKey = 'personal' | 'work' | 'contact' | 'assets';

const MyProfile: React.FC = () => {
    const {
        user, users, employees, hrmAreas, hrmOffices, hrmEmployeeTypes,
        hrmPositions, hrmSalaryPolicies, hrmWorkSchedules, hrmConstructionSites,
        orgUnits, assets, assetAssignments, assetCategories
    } = useApp();

    const [activeTab, setActiveTab] = useState<TabKey>('personal');

    // Find the employee record linked to the current user
    const employee = useMemo(() => {
        return employees.find(e => e.userId === user.id);
    }, [employees, user.id]);

    const linkedUser = user;

    // Lookup helpers
    const area = hrmAreas.find(a => a.id === employee?.areaId);
    const office = hrmOffices.find(o => o.id === employee?.officeId);
    const position = hrmPositions.find(p => p.id === employee?.positionId);
    const empType = hrmEmployeeTypes.find(t => t.id === employee?.employeeTypeId);
    const salaryPolicy = hrmSalaryPolicies.find(s => s.id === employee?.salaryPolicyId);
    const workSchedule = hrmWorkSchedules.find(w => w.id === employee?.workScheduleId);
    const constructionSite = hrmConstructionSites.find(cs => cs.id === employee?.constructionSiteId);
    const department = orgUnits.find(u => u.id === employee?.departmentId);
    const factory = orgUnits.find(u => u.id === employee?.factoryId);

    // Assets assigned to this user
    const employeeAssets = useMemo(() => {
        return assets.filter(a => a.assignedToUserId === user.id && a.status === AssetStatus.IN_USE);
    }, [assets, user.id]);

    const employeeAssetHistory = useMemo(() => {
        return assetAssignments.filter(a => a.userId === user.id);
    }, [assetAssignments, user.id]);

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || '';

    const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
        { key: 'personal', label: 'Cá Nhân', icon: <UserIcon size={16} /> },
        { key: 'work', label: 'Công Việc', icon: <Briefcase size={16} /> },
        { key: 'contact', label: 'Liên Hệ', icon: <Phone size={16} /> },
        { key: 'assets', label: 'Tài Sản', icon: <Landmark size={16} />, count: employeeAssets.length },
    ];

    const InfoRow: React.FC<{ label: string; value?: string | null; icon?: React.ReactNode; badge?: boolean; badgeColor?: string }> = ({ label, value, icon, badge, badgeColor }) => (
        <div className="flex items-center py-3.5 border-b border-slate-100 dark:border-slate-800 last:border-0 group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 -mx-2 px-2 rounded-lg transition-colors">
            {icon && <span className="text-slate-400 mr-3 shrink-0">{icon}</span>}
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 w-40 shrink-0">{label}</span>
            {badge && value ? (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${badgeColor || 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                    {value}
                </span>
            ) : (
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{value || <span className="text-slate-300 dark:text-slate-600 italic">Chưa cập nhật</span>}</span>
            )}
        </div>
    );

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return undefined;
        return new Date(dateStr).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const daysSinceJoin = useMemo(() => {
        if (!employee?.startDate) return null;
        const start = new Date(employee.startDate);
        const now = new Date();
        const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (diff < 30) return `${diff} ngày`;
        if (diff < 365) return `${Math.floor(diff / 30)} tháng`;
        const years = Math.floor(diff / 365);
        const months = Math.floor((diff % 365) / 30);
        return months > 0 ? `${years} năm ${months} tháng` : `${years} năm`;
    }, [employee?.startDate]);

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Profile Header Card */}
            <div className="glass-panel rounded-3xl overflow-hidden">
                {/* Banner */}
                <div className="h-32 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 relative">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(255,255,255,0.2),transparent_60%)]"></div>
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white/10 to-transparent"></div>
                </div>

                {/* Profile Info */}
                <div className="px-8 pb-6 -mt-14 relative">
                    <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
                        {/* Avatar */}
                        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-3xl font-black shadow-2xl shadow-indigo-500/30 border-4 border-white dark:border-slate-900 shrink-0 overflow-hidden">
                            {linkedUser.avatar
                                ? <img src={linkedUser.avatar} className="w-full h-full object-cover" alt="" />
                                : (employee?.fullName || linkedUser.name || '?').charAt(0).toUpperCase()
                            }
                        </div>

                        {/* Name & Role */}
                        <div className="flex-1 min-w-0 pb-1">
                            <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
                                {employee?.fullName || linkedUser.name}
                            </h1>
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                {employee?.employeeCode && (
                                    <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-md flex items-center gap-1">
                                        <Hash size={10} /> {employee.employeeCode}
                                    </span>
                                )}
                                {position && (
                                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-md flex items-center gap-1">
                                        <Award size={10} /> {position.name}
                                    </span>
                                )}
                                {employee?.status && (
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${employee.status === 'Đang làm việc'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                                        }`}>
                                        {employee.status}
                                    </span>
                                )}
                                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md flex items-center gap-1">
                                    <Shield size={10} /> {linkedUser.role}
                                </span>
                            </div>
                        </div>

                        {/* Quick Stats */}
                        <div className="flex gap-4 shrink-0">
                            {daysSinceJoin && (
                                <div className="text-center">
                                    <div className="text-lg font-black text-indigo-600 dark:text-indigo-400">{daysSinceJoin}</div>
                                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Thâm niên</div>
                                </div>
                            )}
                            <div className="text-center">
                                <div className="text-lg font-black text-rose-600 dark:text-rose-400">{employeeAssets.length}</div>
                                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Tài sản</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs + Content */}
            <div className="glass-panel rounded-3xl overflow-hidden">
                {/* Tab Bar */}
                <div className="flex border-b border-slate-100 dark:border-slate-800 px-6 bg-white/50 dark:bg-slate-900/50">
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-2 px-5 py-4 text-xs font-bold uppercase tracking-wider transition border-b-2 -mb-px ${activeTab === tab.key
                                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {tab.count !== undefined && tab.count > 0 && (
                                <span className="text-[9px] font-black bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded-full">{tab.count}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="p-6 md:p-8">
                    {/* === CÁ NHÂN === */}
                    {activeTab === 'personal' && (
                        <div>
                            <InfoRow icon={<UserIcon size={14} />} label="Họ & Tên" value={employee?.fullName || linkedUser.name} />
                            <InfoRow icon={<Heart size={14} />} label="Giới tính" value={employee?.gender} />
                            <InfoRow icon={<Calendar size={14} />} label="Ngày sinh" value={formatDate(employee?.dateOfBirth)} />
                            <InfoRow icon={<Heart size={14} />} label="Tình trạng HN" value={employee?.maritalStatus} />
                            <InfoRow icon={<Award size={14} />} label="Chức danh" value={employee?.title} />
                            <InfoRow icon={<Settings size={14} />} label="Tài khoản" value={`${linkedUser.username} (${linkedUser.email})`} />
                            {!employee && (
                                <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800">
                                    <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                                        ⚠️ Hồ sơ nhân sự chưa được liên kết với tài khoản. Liên hệ Admin để cập nhật.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* === CÔNG VIỆC === */}
                    {activeTab === 'work' && (
                        <div>
                            <InfoRow icon={<MapPin size={14} />} label="Khu vực" value={area?.name} badge badgeColor="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" />
                            <InfoRow icon={<Building size={14} />} label="Văn phòng" value={office?.name} badge badgeColor="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" />
                            <InfoRow icon={<Award size={14} />} label="Vị trí" value={position?.name} badge badgeColor="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" />
                            <InfoRow icon={<FileText size={14} />} label="Loại NV" value={empType?.name} />
                            <InfoRow icon={<Package size={14} />} label="Chính sách lương" value={salaryPolicy?.name} />
                            <InfoRow icon={<Clock size={14} />} label="Lịch làm việc" value={workSchedule?.name} />
                            <InfoRow icon={<Building size={14} />} label="Công trường" value={constructionSite?.name} badge badgeColor="bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" />
                            <InfoRow icon={<Building size={14} />} label="Phòng / Ban" value={department?.name} badge badgeColor="bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400" />
                            <InfoRow icon={<Building size={14} />} label="Nhà máy" value={factory?.name} badge badgeColor="bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" />
                            <InfoRow icon={<Calendar size={14} />} label="Ngày vào" value={formatDate(employee?.startDate)} />
                            <InfoRow icon={<Calendar size={14} />} label="Ngày chính thức" value={formatDate(employee?.officialDate)} />
                        </div>
                    )}

                    {/* === LIÊN HỆ === */}
                    {activeTab === 'contact' && (
                        <div>
                            <InfoRow icon={<Phone size={14} />} label="Số điện thoại" value={employee?.phone || linkedUser.phone} />
                            <InfoRow icon={<Mail size={14} />} label="Email" value={employee?.email || linkedUser.email} />
                        </div>
                    )}

                    {/* === TÀI SẢN === */}
                    {activeTab === 'assets' && (
                        <div className="space-y-6">
                            {/* Currently assigned */}
                            <div>
                                <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <Landmark size={12} /> Tài sản đang sử dụng ({employeeAssets.length})
                                </h4>
                                {employeeAssets.length === 0 ? (
                                    <div className="text-center py-10 text-slate-300 dark:text-slate-600">
                                        <Landmark size={40} className="mx-auto mb-3 opacity-30" />
                                        <p className="text-sm font-bold">Chưa được cấp phát tài sản nào</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {employeeAssets.map(asset => (
                                            <div key={asset.id} className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center text-white shrink-0 shadow-sm">
                                                    <Landmark size={16} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-black text-slate-800 dark:text-white truncate">{asset.name}</div>
                                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
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
                                        <div className="text-right text-xs font-black text-rose-600 dark:text-rose-400 pt-2 pr-1">
                                            Tổng giá trị: {employeeAssets.reduce((s, a) => s + a.originalValue, 0).toLocaleString('vi-VN')}đ
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* History */}
                            {employeeAssetHistory.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Lịch sử cấp phát / thu hồi</h4>
                                    <div className="space-y-1">
                                        {employeeAssetHistory.map(record => {
                                            const asset = assets.find(a => a.id === record.assetId);
                                            const isAssign = record.type === 'assign';
                                            return (
                                                <div key={record.id} className="flex items-center gap-2 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
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
            </div>
        </div>
    );
};

export default MyProfile;
