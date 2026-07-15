import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useModuleData } from '../hooks/useModuleData';
import { Employee, AssetStatus, Asset } from '../types';
import {
    User as UserIcon, Briefcase, Phone, Calendar, MapPin, Building,
    Heart, Landmark, Mail, Shield, Clock, Award, ChevronRight,
    Settings, Package, FileText, Hash, Edit3, Save, X, Check,
    Sparkles, Zap, TrendingUp, Activity, Medal, Camera, Loader2
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase';
import AchievementWall from '../components/AchievementWall';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { employeeSelfService } from '../lib/employeeSelfService';

type TabKey = 'personal' | 'work' | 'contact' | 'assets' | 'achievements';

const InfoRow: React.FC<{ label: string; value?: string | null; icon?: React.ReactNode; badge?: boolean; badgeColor?: string }> = ({ label, value, icon, badge, badgeColor }) => (
    <div className="group flex items-center py-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.03] -mx-3 px-3 rounded-xl transition-all duration-300">
        {icon && (
            <span className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mr-3 shrink-0 text-indigo-500 dark:text-indigo-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-all duration-300">
                {icon}
            </span>
        )}
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 w-36 shrink-0">{label}</span>
        {badge && value ? (
            <span className={`text-[11px] font-bold px-3 py-1 rounded-lg ${badgeColor || 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20'}`}>
                {value}
            </span>
        ) : (
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{value || <span className="text-slate-300 dark:text-slate-600 italic text-xs">Chưa cập nhật</span>}</span>
        )}
    </div>
);

const EditRow: React.FC<{
    label: string; icon?: React.ReactNode;
    type?: 'text' | 'date' | 'select';
    value: string; onChange: (v: string) => void;
    options?: { value: string; label: string }[];
}> = ({ label, icon, type = 'text', value, onChange, options }) => (
    <div className="flex items-center py-3 border-b border-white/5 dark:border-white/[0.03] last:border-0 -mx-3 px-3 rounded-xl">
        {icon && (
            <span className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center mr-3 shrink-0 text-indigo-400">
                {icon}
            </span>
        )}
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400/80 dark:text-slate-500 w-36 shrink-0">{label}</span>
        <div className="flex-1">
            {type === 'select' && options ? (
                <select
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className="w-full p-2.5 border border-white/10 rounded-xl text-sm font-semibold bg-white/[0.04] dark:bg-white/[0.03] backdrop-blur-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all text-slate-700 dark:text-slate-200"
                >
                    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            ) : (
                <input
                    type={type}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className="w-full p-2.5 border border-white/10 rounded-xl text-sm font-semibold bg-white/[0.04] dark:bg-white/[0.03] backdrop-blur-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all text-slate-700 dark:text-slate-200"
                />
            )}
        </div>
    </div>
);

const MyProfile: React.FC = () => {
    const {
        user, employees, hrmAreas, hrmOffices, hrmEmployeeTypes,
        hrmPositions, hrmSalaryPolicies, hrmWorkSchedules, hrmConstructionSites,
        orgUnits, assets, assetAssignments, assetCategories,
        updateEmployee, updateUser, replaceEmployeeLocal,
    } = useApp();
    useModuleData('hrm');
    useModuleData('ts');
    const toast = useToast();

    const [activeTab, setActiveTab] = useState<TabKey>('personal');
    const [isEditing, setIsEditing] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
            const path = `employees/${employee?.id || user.id}_${Date.now()}.${ext}`;
            const { error } = await supabase.storage.from('avatars').upload(path, file, { cacheControl: '3600', upsert: true });
            if (error) throw error;
            const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
            const url = urlData.publicUrl;

            if (employee) {
                const updatedEmployee = await employeeSelfService.updateMyProfile({ avatarUrl: url });
                if (updatedEmployee) {
                    replaceEmployeeLocal(updatedEmployee);
                    await updateUser({ ...linkedUser, avatar: url });
                } else {
                    await updateEmployee({ ...employee, avatarUrl: url });
                    await updateUser({ ...linkedUser, avatar: url });
                }
            } else {
                await updateUser({ ...linkedUser, avatar: url });
            }

            toast.success('Đã thay đổi ảnh đại diện mới thành công!');
        } catch (err: any) {
            logApiError('myProfile.avatarUpload', err);
            toast.error('Không thể tải ảnh đại diện', getApiErrorMessage(err, 'Lỗi kết nối hoặc quyền truy cập Storage.'));
        } finally {
            setUploadingAvatar(false);
        }
    };

    const employee = useMemo(() => {
        return employees.find(e => e.userId === user.id);
    }, [employees, user.id]);

    const linkedUser = user;

    const [editForm, setEditForm] = useState({
        fullName: '',
        gender: '' as 'Nam' | 'Nữ' | 'Khác',
        dateOfBirth: '',
        maritalStatus: '',
        phone: '',
    });

    const startEditing = () => {
        setEditForm({
            fullName: employee?.fullName || linkedUser.name || '',
            gender: (employee?.gender || 'Nam') as 'Nam' | 'Nữ' | 'Khác',
            dateOfBirth: employee?.dateOfBirth || '',
            maritalStatus: employee?.maritalStatus || '',
            phone: employee?.phone || linkedUser.phone || '',
        });
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setIsEditing(false);
    };

    const saveEditing = async () => {
        setSavingProfile(true);
        try {
            let updatedEmployee: Employee | null = null;
            if (employee) {
                const patch = {
                    fullName: editForm.fullName,
                    gender: editForm.gender,
                    dateOfBirth: editForm.dateOfBirth,
                    maritalStatus: editForm.maritalStatus,
                    phone: editForm.phone,
                };
                updatedEmployee = await employeeSelfService.updateMyProfile(patch);
                if (updatedEmployee) {
                    replaceEmployeeLocal(updatedEmployee);
                } else {
                    await updateEmployee({
                        ...employee,
                        ...patch,
                        updatedAt: new Date().toISOString(),
                    });
                }
            }
            if (updatedEmployee) {
                await updateUser({
                    ...linkedUser,
                    name: editForm.fullName,
                    phone: editForm.phone,
                    avatar: updatedEmployee.avatarUrl || linkedUser.avatar,
                });
            } else if (editForm.fullName !== linkedUser.name || editForm.phone !== (linkedUser.phone || '')) {
                await updateUser({
                    ...linkedUser,
                    name: editForm.fullName,
                    phone: editForm.phone,
                });
            }
            setIsEditing(false);
            toast.success('Đã cập nhật thông tin cá nhân!');
        } catch (error: any) {
            logApiError('myProfile.saveEditing', error);
            toast.error('Không thể cập nhật hồ sơ', getApiErrorMessage(error, 'Không thể cập nhật thông tin cá nhân.'));
        } finally {
            setSavingProfile(false);
        }
    };

    const area = hrmAreas.find(a => a.id === employee?.areaId);
    const office = hrmOffices.find(o => o.id === employee?.officeId);
    const position = hrmPositions.find(p => p.id === employee?.positionId);
    const empType = hrmEmployeeTypes.find(t => t.id === employee?.employeeTypeId);
    const salaryPolicy = hrmSalaryPolicies.find(s => s.id === employee?.salaryPolicyId);
    const workSchedule = hrmWorkSchedules.find(w => w.id === employee?.workScheduleId);
    const constructionSite = hrmConstructionSites.find(cs => cs.id === employee?.constructionSiteId);
    const department = orgUnits.find(u => u.id === employee?.departmentId);
    const factory = orgUnits.find(u => u.id === employee?.factoryId);

    const employeeAssets = useMemo(() => {
        return assets.filter(a => a.assignedToUserId === user.id && a.status === AssetStatus.IN_USE);
    }, [assets, user.id]);

    const employeeAssetHistory = useMemo(() => {
        return assetAssignments.filter(a => a.userId === user.id);
    }, [assetAssignments, user.id]);

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || '';

    const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
        { key: 'personal', label: 'Cá Nhân', icon: <UserIcon size={15} /> },
        { key: 'work', label: 'Công Việc', icon: <Briefcase size={15} /> },
        { key: 'contact', label: 'Liên Hệ', icon: <Phone size={15} /> },
        { key: 'assets', label: 'Tài Sản', icon: <Landmark size={15} />, count: employeeAssets.length },
        { key: 'achievements', label: 'Thành Tích', icon: <Medal size={15} /> },
    ];

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
        <div className="max-w-4xl mx-auto space-y-5">

            {/* ═══════════════════════════════════════════════
                HERO BANNER — Animated Gradient + Glass
               ═══════════════════════════════════════════════ */}
            <div className="relative rounded-3xl overflow-hidden"
                style={{
                    background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 40%, #24243e 100%)',
                    boxShadow: '0 20px 60px -12px rgba(48,43,99,0.5)',
                }}
            >
                {/* Animated mesh bg */}
                <div className="absolute inset-0 opacity-30">
                    <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '4s' }} />
                    <div className="absolute top-0 right-0 w-72 h-72 bg-cyan-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
                    <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }} />
                </div>

                {/* Grid pattern overlay */}
                <div className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                        backgroundSize: '40px 40px',
                    }}
                />

                {/* Content */}
                <div className="relative px-6 sm:px-8 py-8 sm:py-10">
                    <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 sm:gap-6">
                        {/* Avatar with dynamic premium hover change overlay */}
                        <div className="relative group select-none">
                            <div className="absolute -inset-1.5 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 rounded-2xl blur-md opacity-50 group-hover:opacity-100 transition-all duration-500 scale-95 group-hover:scale-105" />
                            <div
                                onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
                                className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-3xl sm:text-4xl font-black text-white overflow-hidden ring-4 ring-white/10 dark:ring-slate-900/40 transition-all duration-300 ${
                                    uploadingAvatar ? 'cursor-wait opacity-80' : 'cursor-pointer hover:scale-102 hover:rotate-1'
                                }`}
                            >
                                {linkedUser.avatar ? (
                                    <img src={linkedUser.avatar} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="Avatar" />
                                ) : (
                                    <span className="group-hover:scale-110 transition-transform duration-500">
                                        {(employee?.fullName || linkedUser.name || '?').charAt(0).toUpperCase()}
                                    </span>
                                )}

                                {/* Glassmorphism Hover Overlay */}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center gap-1.5 text-white">
                                    {uploadingAvatar ? (
                                        <Loader2 size={18} className="animate-spin text-cyan-300" />
                                    ) : (
                                        <>
                                            <Camera size={18} className="text-white transform translate-y-1 group-hover:translate-y-0 transition-transform duration-300" />
                                            <span className="text-[9px] font-black uppercase tracking-wider">Đổi ảnh</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Hidden File Input */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                disabled={uploadingAvatar}
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) handleAvatarUpload(f);
                                }}
                            />

                            {/* Online indicator with pulse */}
                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full border-3 border-[#24243e] shadow-lg shadow-emerald-400/50 flex items-center justify-center">
                                <span className="absolute w-2 h-2 rounded-full bg-emerald-100 animate-ping" />
                            </div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0 text-center sm:text-left pb-1">
                            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight drop-shadow-lg">
                                {employee?.fullName || linkedUser.name}
                            </h1>
                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-2.5">
                                {employee?.employeeCode && (
                                    <span className="text-[10px] font-bold text-cyan-300 bg-cyan-400/10 px-2.5 py-1 rounded-lg flex items-center gap-1 backdrop-blur-sm border border-cyan-400/20">
                                        <Hash size={10} /> {employee.employeeCode}
                                    </span>
                                )}
                                {position && (
                                    <span className="text-[10px] font-bold text-amber-300 bg-amber-400/10 px-2.5 py-1 rounded-lg flex items-center gap-1 backdrop-blur-sm border border-amber-400/20">
                                        <Award size={10} /> {position.name}
                                    </span>
                                )}
                                {employee?.status && (
                                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg backdrop-blur-sm border ${employee.status === 'Đang làm việc'
                                        ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20'
                                        : 'bg-red-400/10 text-red-300 border-red-400/20'
                                    }`}>
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse" />
                                        {employee.status}
                                    </span>
                                )}
                                <span className="text-[10px] font-bold text-slate-300 bg-white/5 px-2.5 py-1 rounded-lg flex items-center gap-1 backdrop-blur-sm border border-white/10">
                                    <Shield size={10} /> {linkedUser.role}
                                </span>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="flex gap-3 shrink-0">
                            {daysSinceJoin && (
                                <div className="text-center px-4 py-3 rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/10 hover:bg-white/[0.1] transition-all duration-300 group cursor-default">
                                    <div className="flex items-center justify-center gap-1 mb-1">
                                        <TrendingUp size={12} className="text-purple-400 group-hover:text-purple-300 transition-colors" />
                                    </div>
                                    <div className="text-lg font-black text-white drop-shadow-lg">{daysSinceJoin}</div>
                                    <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400">Thâm niên</div>
                                </div>
                            )}
                            <div className="text-center px-4 py-3 rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/10 hover:bg-white/[0.1] transition-all duration-300 group cursor-default">
                                <div className="flex items-center justify-center gap-1 mb-1">
                                    <Zap size={12} className="text-rose-400 group-hover:text-rose-300 transition-colors" />
                                </div>
                                <div className="text-lg font-black text-white drop-shadow-lg">{employeeAssets.length}</div>
                                <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400">Tài sản</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════
                TAB CONTENT — Frosted Glass Panel
               ═══════════════════════════════════════════════ */}
            <div className="rounded-3xl overflow-hidden bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-lg dark:shadow-slate-900/40 backdrop-blur-xl"
            >
                {/* Tab Bar */}
                <div className="flex overflow-x-auto px-2 sm:px-4 pt-2 gap-1 bg-slate-50/80 dark:bg-slate-900/50 border-b border-slate-200/60 dark:border-slate-700/40"
                >
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => { setActiveTab(tab.key); setIsEditing(false); }}
                            className={`flex items-center gap-2 px-4 sm:px-5 py-3 text-[11px] font-bold uppercase tracking-wider transition-all duration-300 rounded-t-xl whitespace-nowrap ${activeTab === tab.key
                                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200 dark:border-slate-700 border-b-transparent -mb-px'
                                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/40'
                            }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {tab.count !== undefined && tab.count > 0 && (
                                <span className="text-[9px] font-black bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded-full border border-rose-500/20">{tab.count}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-4 sm:p-6 md:p-8">

                    {/* === CÁ NHÂN === */}
                    {activeTab === 'personal' && (
                        <div>
                            <div className="flex justify-end mb-4 gap-2">
                                {!isEditing ? (
                                    <button onClick={startEditing}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 bg-indigo-500/5 text-indigo-600 hover:bg-indigo-500/10 border border-indigo-500/10 hover:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20 group"
                                    >
                                        <Edit3 size={12} className="group-hover:rotate-12 transition-transform" /> Sửa thông tin
                                    </button>
                                ) : (
                                    <>
                                        <button onClick={cancelEditing} disabled={savingProfile} className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all border border-slate-200 disabled:opacity-60">
                                            <X size={12} /> Hủy
                                        </button>
                                        <button onClick={saveEditing} disabled={savingProfile}
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 disabled:opacity-60"
                                            style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                                        >
                                            <Check size={12} /> {savingProfile ? 'Đang lưu...' : 'Lưu'}
                                        </button>
                                    </>
                                )}
                            </div>

                            {isEditing ? (
                                <div className="space-y-1 bg-slate-50/30 dark:bg-slate-900/5 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 shadow-inner">
                                    <EditRow icon={<UserIcon size={14} />} label="Họ & Tên" value={editForm.fullName} onChange={v => setEditForm({...editForm, fullName: v})} />
                                    <EditRow icon={<Heart size={14} />} label="Giới tính" type="select" value={editForm.gender} onChange={v => setEditForm({...editForm, gender: v as any})}
                                        options={[{ value: 'Nam', label: 'Nam' }, { value: 'Nữ', label: 'Nữ' }, { value: 'Khác', label: 'Khác' }]} />
                                    <EditRow icon={<Calendar size={14} />} label="Ngày sinh" type="date" value={editForm.dateOfBirth} onChange={v => setEditForm({...editForm, dateOfBirth: v})} />
                                    <EditRow icon={<Heart size={14} />} label="Tình trạng HN" type="select" value={editForm.maritalStatus} onChange={v => setEditForm({...editForm, maritalStatus: v})}
                                        options={[{ value: '', label: 'Chưa cập nhật' }, { value: 'Độc thân', label: 'Độc thân' }, { value: 'Đã kết hôn', label: 'Đã kết hôn' }, { value: 'Ly hôn', label: 'Ly hôn' }]} />
                                    <EditRow icon={<Phone size={14} />} label="Số điện thoại" value={editForm.phone} onChange={v => setEditForm({...editForm, phone: v})} />
                                    <InfoRow icon={<Award size={14} />} label="Chức danh" value={employee?.title} />
                                    <InfoRow icon={<Settings size={14} />} label="Tài khoản" value={`${linkedUser.username} (${linkedUser.email})`} />
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Left Column Card: Basic Info */}
                                    <div className="bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm space-y-1 hover:shadow-md transition-shadow duration-300">
                                        <h4 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-200/50 dark:border-slate-700/50 pb-2">
                                            <UserIcon size={12} /> Thông tin cơ bản
                                        </h4>
                                        <InfoRow icon={<UserIcon size={14} />} label="Họ & Tên" value={employee?.fullName || linkedUser.name} />
                                        <InfoRow icon={<Heart size={14} />} label="Giới tính" value={employee?.gender} />
                                        <InfoRow icon={<Calendar size={14} />} label="Ngày sinh" value={formatDate(employee?.dateOfBirth)} />
                                        <InfoRow icon={<Heart size={14} />} label="Hôn nhân" value={employee?.maritalStatus} />
                                    </div>
                                    {/* Right Column Card: Account & Work */}
                                    <div className="bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm space-y-1 hover:shadow-md transition-shadow duration-300">
                                        <h4 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-200/50 dark:border-slate-700/50 pb-2">
                                            <Settings size={12} /> Tài khoản & Chức danh
                                        </h4>
                                        <InfoRow icon={<Phone size={14} />} label="Số điện thoại" value={employee?.phone || linkedUser.phone} />
                                        <InfoRow icon={<Award size={14} />} label="Chức danh" value={employee?.title} />
                                        <InfoRow icon={<Settings size={14} />} label="Tài khoản" value={`${linkedUser.username} (${linkedUser.email})`} />
                                    </div>
                                </div>
                            )}
                            {!employee && (
                                <div className="mt-6 p-4 rounded-xl border border-amber-400/20 bg-amber-400/5 backdrop-blur-sm">
                                    <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                                        ⚠️ Hồ sơ nhân sự chưa được liên kết với tài khoản. Liên hệ Admin để cập nhật.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* === CÔNG VIỆC === */}
                    {activeTab === 'work' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left Card: Placement */}
                            <div className="bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm space-y-1 hover:shadow-md transition-shadow duration-300">
                                <h4 className="text-[11px] font-black text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-200/50 dark:border-slate-700/50 pb-2">
                                    <Building size={12} /> Đơn vị & Cơ sở
                                </h4>
                                <InfoRow icon={<MapPin size={14} />} label="Khu vực" value={area?.name} badge badgeColor="bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20" />
                                <InfoRow icon={<Building size={14} />} label="Văn phòng" value={office?.name} badge badgeColor="bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20" />
                                <InfoRow icon={<Building size={14} />} label="Công trường" value={constructionSite?.name} badge badgeColor="bg-orange-500/10 text-orange-500 dark:text-orange-400 border border-orange-500/20" />
                                <InfoRow icon={<Building size={14} />} label="Phòng / Ban" value={department?.name} badge badgeColor="bg-sky-500/10 text-sky-500 dark:text-sky-400 border border-sky-500/20" />
                                <InfoRow icon={<Building size={14} />} label="Nhà máy" value={factory?.name} badge badgeColor="bg-purple-500/10 text-purple-500 dark:text-purple-400 border border-purple-500/20" />
                            </div>

                            {/* Right Card: Contract & Policy */}
                            <div className="bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm space-y-1 hover:shadow-md transition-shadow duration-300">
                                <h4 className="text-[11px] font-black text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-200/50 dark:border-slate-700/50 pb-2">
                                    <Briefcase size={12} /> Hợp đồng & Vai trò
                                </h4>
                                <InfoRow icon={<Award size={14} />} label="Vị trí" value={position?.name} badge badgeColor="bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-400/20" />
                                <InfoRow icon={<FileText size={14} />} label="Loại NV" value={empType?.name} />
                                <InfoRow icon={<Package size={14} />} label="Chính sách" value={salaryPolicy?.name} />
                                <InfoRow icon={<Clock size={14} />} label="Lịch làm việc" value={workSchedule?.name} />
                                <InfoRow icon={<Calendar size={14} />} label="Ngày vào" value={formatDate(employee?.startDate)} />
                                <InfoRow icon={<Calendar size={14} />} label="Ngày chính thức" value={formatDate(employee?.officialDate)} />
                            </div>
                        </div>
                    )}

                    {/* === LIÊN HỆ === */}
                    {activeTab === 'contact' && (
                        <div className="max-w-md mx-auto bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm space-y-1 hover:shadow-md transition-shadow duration-300">
                            <h4 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest mb-4 flex items-center gap-1.5 border-b border-slate-200/50 dark:border-slate-700/50 pb-2">
                                <Phone size={12} /> Thông tin liên hệ
                            </h4>
                            <InfoRow icon={<Phone size={14} />} label="Số điện thoại" value={employee?.phone || linkedUser.phone} />
                            <InfoRow icon={<Mail size={14} />} label="Email liên hệ" value={employee?.email || linkedUser.email} />
                        </div>
                    )}

                    {/* === TÀI SẢN === */}
                    {activeTab === 'assets' && (
                        <div className="space-y-6">
                            {/* Currently assigned */}
                            <div>
                                <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-lg bg-rose-500/10 flex items-center justify-center">
                                        <Landmark size={11} />
                                    </div>
                                    Tài sản đang sử dụng ({employeeAssets.length})
                                </h4>
                                {employeeAssets.length === 0 ? (
                                    <div className="text-center py-12 rounded-2xl bg-slate-50 dark:bg-slate-700/20 border border-dashed border-slate-200 dark:border-slate-700/50">
                                        <Landmark size={36} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                                        <p className="text-sm font-bold text-slate-400 dark:text-slate-500">Chưa được cấp phát tài sản nào</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2.5">
                                        {employeeAssets.map(asset => (
                                            <div key={asset.id}
                                                className="flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 hover:shadow-lg group cursor-default bg-white/70 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700/50"
                                            >
                                                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-rose-500/20 group-hover:scale-105 transition-transform"
                                                    style={{ background: 'linear-gradient(135deg, #f43f5e, #e11d48)' }}
                                                >
                                                    <Landmark size={17} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-black text-slate-800 dark:text-white truncate">{asset.name}</div>
                                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                                                        <span className="font-mono font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{asset.code}</span>
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
                                        <div className="text-right text-xs font-black text-rose-500 pt-2 pr-1">
                                            Tổng giá trị: {employeeAssets.reduce((s, a) => s + a.originalValue, 0).toLocaleString('vi-VN')}đ
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* History */}
                            {employeeAssetHistory.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                                        <Activity size={11} /> Lịch sử cấp phát / thu hồi
                                    </h4>
                                    <div className="space-y-1">
                                        {employeeAssetHistory.map(record => {
                                            const asset = assets.find(a => a.id === record.assetId);
                                            const isAssign = record.type === 'assign';
                                            return (
                                                <div key={record.id} className="flex items-center gap-2.5 py-3 border-b border-white/5 dark:border-white/[0.03] last:border-0">
                                                    <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md border ${isAssign ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'}`}>
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

                    {/* === THÀNH TÍCH === */}
                    {activeTab === 'achievements' && (
                        <AchievementWall />
                    )}
                </div>
            </div>
        </div>
    );
};

export default MyProfile;
