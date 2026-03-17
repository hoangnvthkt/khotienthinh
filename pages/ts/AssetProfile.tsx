import React, { useMemo, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
    ArrowLeft, Landmark, User, Calendar, DollarSign, Shield, Wrench,
    ArrowLeftRight, ArrowRight, UserPlus, UserMinus, Clock, Tag,
    MapPin, Hash, FileText, Paperclip, Upload, X, Plus, CheckCircle,
    AlertTriangle, Package, Building2, Download, Printer
} from 'lucide-react';
import { AssetStatus, ASSET_STATUS_LABELS, AssetMaintenance, MaintenanceAttachment } from '../../types';

const TYPE_LABELS: Record<string, string> = { scheduled: 'Bảo trì định kỳ', repair: 'Sửa chữa', inspection: 'Kiểm tra' };
const STATUS_LABELS: Record<string, string> = { planned: 'Lên kế hoạch', in_progress: 'Đang thực hiện', completed: 'Hoàn thành' };

const AssetProfile: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const {
        assets, assetAssignments, assetMaintenances, assetCategories, warehouses, users, user,
        addAssetMaintenance,
    } = useApp();
    const toast = useToast();

    const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'maintenance' | 'costs'>('overview');
    const [showAddMaintenance, setShowAddMaintenance] = useState(false);

    // Maintenance quick-add form
    const [mForm, setMForm] = useState({
        type: 'repair' as 'scheduled' | 'repair' | 'inspection',
        description: '', cost: 0, vendor: '', invoiceNumber: '',
        startDate: new Date().toISOString().split('T')[0], status: 'in_progress' as any, note: '',
    });
    const [mAttachments, setMAttachments] = useState<MaintenanceAttachment[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);

    const asset = useMemo(() => assets.find(a => a.id === id), [assets, id]);

    // All assignment/transfer history for this asset
    const assignmentHistory = useMemo(() => {
        return assetAssignments.filter(a => a.assetId === id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [assetAssignments, id]);

    // All maintenance for this asset
    const maintenanceHistory = useMemo(() => {
        return assetMaintenances.filter(m => m.assetId === id).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }, [assetMaintenances, id]);

    // Cost summary
    const costSummary = useMemo(() => {
        const totalMaintenance = maintenanceHistory.reduce((sum, m) => sum + m.cost, 0);
        const repairCost = maintenanceHistory.filter(m => m.type === 'repair').reduce((sum, m) => sum + m.cost, 0);
        const scheduledCost = maintenanceHistory.filter(m => m.type === 'scheduled').reduce((sum, m) => sum + m.cost, 0);
        return { totalMaintenance, repairCost, scheduledCost, count: maintenanceHistory.length };
    }, [maintenanceHistory]);

    if (!asset) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh]">
                <Package size={60} className="text-slate-200 mb-4" />
                <p className="text-slate-400 font-bold text-lg">Không tìm thấy tài sản</p>
                <button onClick={() => navigate('/ts/catalog')} className="mt-4 px-6 py-2 rounded-xl bg-blue-500 text-white font-bold text-sm">
                    <ArrowLeft size={14} className="inline mr-1" /> Quay lại
                </button>
            </div>
        );
    }

    // Depreciation calc
    const purchaseDate = new Date(asset.purchaseDate);
    const monthsUsed = Math.max(0, Math.floor((Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
    const totalDepMonths = asset.depreciationYears * 12;
    const depPerMonth = totalDepMonths > 0 ? (asset.originalValue - asset.residualValue) / totalDepMonths : 0;
    const accumulated = Math.min(depPerMonth * monthsUsed, asset.originalValue - asset.residualValue);
    const remaining = asset.originalValue - accumulated;
    const depPercent = totalDepMonths > 0 ? Math.min(100, (monthsUsed / totalDepMonths) * 100) : 0;

    // Warranty calc
    const warrantyMonths = asset.warrantyMonths || 0;
    const warrantyEndDate = new Date(purchaseDate);
    warrantyEndDate.setMonth(warrantyEndDate.getMonth() + warrantyMonths);
    const warrantyDaysLeft = Math.floor((warrantyEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const warrantyPercent = warrantyMonths > 0 ? Math.max(0, Math.min(100, (warrantyDaysLeft / (warrantyMonths * 30.44)) * 100)) : 0;

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || '';
    const getWarehouseName = (wId?: string) => wId ? warehouses.find(w => w.id === wId)?.name || '' : '';
    const formatCurrency = (v: number) => v.toLocaleString('vi-VN') + 'đ';
    const formatFileSize = (bytes: number) => bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';

    const getStatusConfig = (status: AssetStatus) => {
        switch (status) {
            case AssetStatus.AVAILABLE: return { color: 'bg-emerald-100 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/30', icon: CheckCircle };
            case AssetStatus.IN_USE: return { color: 'bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/30', icon: User };
            case AssetStatus.MAINTENANCE: return { color: 'bg-amber-100 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/30', icon: Wrench };
            case AssetStatus.DISPOSED: return { color: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700', icon: Package };
            default: return { color: 'bg-slate-100 text-slate-500 border-slate-200', icon: Package };
        }
    };

    const cfg = getStatusConfig(asset.status);
    const StatusIcon = cfg.icon;

    // Handle quick-add maintenance
    const handleAddMaintenance = () => {
        if (!mForm.description.trim()) { toast.error('Lỗi', 'Vui lòng nhập mô tả'); return; }
        const m: AssetMaintenance = {
            id: `mt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            assetId: asset.id, type: mForm.type, description: mForm.description,
            cost: Number(mForm.cost), vendor: mForm.vendor || undefined,
            invoiceNumber: mForm.invoiceNumber || undefined,
            startDate: mForm.startDate, status: mForm.status,
            performedBy: user.id, performedByName: user.name, note: mForm.note || undefined,
            attachments: mAttachments.length > 0 ? mAttachments : undefined,
        };
        addAssetMaintenance(m);
        toast.success('Thành công', `Đã ghi nhận bảo trì cho ${asset.name}`);
        setShowAddMaintenance(false);
        setMForm({ type: 'repair', description: '', cost: 0, vendor: '', invoiceNumber: '', startDate: new Date().toISOString().split('T')[0], status: 'in_progress', note: '' });
        setMAttachments([]);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        Array.from(files).forEach((file: File) => {
            const reader = new FileReader();
            reader.onload = () => {
                setMAttachments(prev => [...prev, {
                    id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                    name: file.name, url: reader.result as string, type: file.type, size: file.size,
                    uploadedAt: new Date().toISOString(),
                }]);
            };
            reader.readAsDataURL(file);
        });
        if (fileRef.current) fileRef.current.value = '';
    };

    // Merge timeline (assignments + maintenances)
    const timeline = useMemo(() => {
        const items: { date: string; type: string; title: string; desc: string; icon: any; color: string }[] = [];
        assignmentHistory.forEach(a => {
            if (a.type === 'assign') items.push({ date: a.date, type: 'assign', title: 'Cấp phát', desc: `Giao cho ${a.userName}`, icon: UserPlus, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' });
            else if (a.type === 'return') items.push({ date: a.date, type: 'return', title: 'Thu hồi', desc: `Thu hồi từ ${a.userName}`, icon: UserMinus, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/30' });
            else if (a.type === 'transfer') items.push({ date: a.date, type: 'transfer', title: 'Luân chuyển', desc: `${a.fromUserName} → ${a.userName}`, icon: ArrowLeftRight, color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/30' });
        });
        maintenanceHistory.forEach(m => {
            items.push({ date: m.startDate, type: 'maintenance', title: TYPE_LABELS[m.type], desc: `${m.description} — ${formatCurrency(m.cost)}`, icon: Wrench, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/30' });
        });
        return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [assignmentHistory, maintenanceHistory]);

    return (
        <div className="space-y-6">
            {/* Back + Header */}
            <div className="flex items-center gap-4">
                <button onClick={() => navigate('/ts/catalog')} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{asset.code}</span>
                        <h1 className="text-2xl font-black text-slate-800 dark:text-white">{asset.name}</h1>
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black uppercase border ${cfg.color}`}>
                            <StatusIcon size={12} /> {ASSET_STATUS_LABELS[asset.status]}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1"><Tag size={10} /> {getCategoryName(asset.categoryId)}</span>
                        {asset.brand && <span>• {asset.brand} {asset.model || ''}</span>}
                        {asset.serialNumber && <span>• SN: {asset.serialNumber}</span>}
                    </div>
                </div>
            </div>

            {/* Quick Info Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[9px] text-slate-400 font-bold uppercase">Nguyên giá</p>
                    <p className="text-lg font-black text-slate-800 dark:text-white">{formatCurrency(asset.originalValue)}</p>
                    <p className="text-[9px] text-slate-400">Mua {new Date(asset.purchaseDate).toLocaleDateString('vi-VN')}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[9px] text-slate-400 font-bold uppercase">Giá trị còn lại</p>
                    <p className="text-lg font-black text-emerald-600">{formatCurrency(remaining)}</p>
                    <p className="text-[9px] text-slate-400">KH: {depPercent.toFixed(0)}%</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[9px] text-slate-400 font-bold uppercase">Chi phí BT/SC</p>
                    <p className="text-lg font-black text-red-600">{formatCurrency(costSummary.totalMaintenance)}</p>
                    <p className="text-[9px] text-slate-400">{costSummary.count} lần bảo trì</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[9px] text-slate-400 font-bold uppercase">Bảo hành</p>
                    {warrantyMonths > 0 ? (
                        <>
                            <p className={`text-lg font-black ${warrantyDaysLeft <= 0 ? 'text-slate-400' : warrantyDaysLeft <= 30 ? 'text-red-600' : warrantyDaysLeft <= 90 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {warrantyDaysLeft <= 0 ? 'Hết hạn' : `${warrantyDaysLeft} ngày`}
                            </p>
                            <p className="text-[9px] text-slate-400">Đến {warrantyEndDate.toLocaleDateString('vi-VN')}</p>
                        </>
                    ) : (
                        <p className="text-lg font-black text-slate-300">Không BH</p>
                    )}
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[9px] text-slate-400 font-bold uppercase">Người dùng hiện tại</p>
                    {asset.assignedToName ? (
                        <>
                            <p className="text-lg font-black text-blue-600">{asset.assignedToName}</p>
                            {asset.assignedDate && <p className="text-[9px] text-slate-400">Từ {new Date(asset.assignedDate).toLocaleDateString('vi-VN')}</p>}
                        </>
                    ) : (
                        <p className="text-lg font-black text-slate-300">Chưa cấp phát</p>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm w-fit">
                {([
                    { key: 'overview', label: 'Tổng quan', icon: Landmark },
                    { key: 'history', label: 'Lịch sử sử dụng', icon: Clock },
                    { key: 'maintenance', label: 'Bảo trì / Sửa chữa', icon: Wrench },
                    { key: 'costs', label: 'Chi phí', icon: DollarSign },
                ] as const).map(t => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                        className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${activeTab === t.key ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-blue-500'}`}>
                        <t.icon size={13} /> {t.label}
                    </button>
                ))}
            </div>

            {/* ==================== OVERVIEW TAB ==================== */}
            {activeTab === 'overview' && (
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Left: Asset details */}
                    <div className="space-y-4">
                        {/* Depreciation */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
                            <p className="text-[10px] text-rose-500 font-black uppercase mb-3 flex items-center gap-1"><DollarSign size={12} /> Khấu hao</p>
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-slate-500">Đã khấu hao ({monthsUsed} tháng)</span>
                                <span className="font-black text-rose-600">{formatCurrency(Math.round(accumulated))}</span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3">
                                <div className="h-3 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all" style={{ width: `${depPercent}%` }} />
                            </div>
                            <div className="flex justify-between text-xs mt-2">
                                <span className="text-slate-400">{depPercent.toFixed(1)}% đã KH</span>
                                <span className="font-black text-emerald-600">Còn lại: {formatCurrency(Math.round(remaining))}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                                <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                                    <p className="text-[8px] text-slate-400 uppercase font-bold">KH/tháng</p>
                                    <p className="text-xs font-black text-slate-700 dark:text-white">{formatCurrency(Math.round(depPerMonth))}</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                                    <p className="text-[8px] text-slate-400 uppercase font-bold">Thời hạn</p>
                                    <p className="text-xs font-black text-slate-700 dark:text-white">{asset.depreciationYears} năm</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                                    <p className="text-[8px] text-slate-400 uppercase font-bold">Thanh lý</p>
                                    <p className="text-xs font-black text-slate-700 dark:text-white">{formatCurrency(asset.residualValue)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Warranty */}
                        {warrantyMonths > 0 && (
                            <div className={`bg-white dark:bg-slate-900 rounded-2xl border shadow-sm p-5 ${warrantyDaysLeft <= 0 ? 'border-slate-200 dark:border-slate-700' : warrantyDaysLeft <= 30 ? 'border-red-200 dark:border-red-900/30' : 'border-sky-200 dark:border-sky-900/30'}`}>
                                <div className="flex items-center justify-between mb-3">
                                    <p className={`text-[10px] font-black uppercase flex items-center gap-1 ${warrantyDaysLeft <= 0 ? 'text-slate-400' : warrantyDaysLeft <= 30 ? 'text-red-500' : 'text-sky-500'}`}>
                                        <Shield size={12} /> Bảo hành
                                    </p>
                                    <span className={`text-xs font-black ${warrantyDaysLeft <= 0 ? 'text-slate-400' : warrantyDaysLeft <= 30 ? 'text-red-600' : 'text-sky-600'}`}>
                                        {warrantyDaysLeft <= 0 ? 'Đã hết hạn' : `Còn ${warrantyDaysLeft} ngày`}
                                    </span>
                                </div>
                                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 mb-2">
                                    <div className={`h-3 rounded-full transition-all ${warrantyDaysLeft <= 0 ? 'bg-slate-300' : warrantyDaysLeft <= 30 ? 'bg-red-500' : warrantyDaysLeft <= 90 ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${warrantyPercent}%` }} />
                                </div>
                                <div className="flex justify-between text-[10px] text-slate-400">
                                    <span>Thời hạn: {warrantyMonths} tháng</span>
                                    <span>Hết hạn: {warrantyEndDate.toLocaleDateString('vi-VN')}</span>
                                </div>
                            </div>
                        )}

                        {/* Location */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
                            <p className="text-[10px] text-slate-400 font-black uppercase mb-3 flex items-center gap-1"><MapPin size={12} /> Vị trí</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                    <p className="text-[9px] text-slate-400 uppercase font-bold">Kho</p>
                                    <p className="text-sm font-bold text-slate-800 dark:text-white">{getWarehouseName(asset.warehouseId) || '—'}</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                    <p className="text-[9px] text-slate-400 uppercase font-bold">Ghi chú vị trí</p>
                                    <p className="text-sm font-bold text-slate-800 dark:text-white">{asset.locationNote || '—'}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right: Timeline */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 max-h-[600px] overflow-y-auto">
                        <p className="text-[10px] text-slate-400 font-black uppercase mb-4 flex items-center gap-1"><Clock size={12} /> Dòng thời gian</p>
                        {timeline.length === 0 ? (
                            <div className="text-center text-slate-300 py-8"><Clock size={30} className="mx-auto mb-2" /><p className="text-sm font-bold">Chưa có hoạt động</p></div>
                        ) : (
                            <div className="space-y-0">
                                {timeline.map((item, i) => {
                                    const ItemIcon = item.icon;
                                    return (
                                        <div key={i} className="flex gap-3 relative">
                                            <div className="flex flex-col items-center">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item.color}`}>
                                                    <ItemIcon size={14} />
                                                </div>
                                                {i < timeline.length - 1 && <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700 my-1" />}
                                            </div>
                                            <div className="pb-4 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-black text-slate-800 dark:text-white">{item.title}</span>
                                                    <span className="text-[9px] text-slate-400">{new Date(item.date).toLocaleDateString('vi-VN')}</span>
                                                </div>
                                                <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ==================== HISTORY TAB ==================== */}
            {activeTab === 'history' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                        <h3 className="text-xs font-black text-slate-500 uppercase">Lịch sử cấp phát / luân chuyển / thu hồi</h3>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {assignmentHistory.length === 0 ? (
                            <div className="p-12 text-center">
                                <Clock size={40} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                                <p className="text-slate-400 font-bold">Chưa có lịch sử cấp phát</p>
                            </div>
                        ) : (
                            assignmentHistory.map(record => {
                                const isA = record.type === 'assign'; const isT = record.type === 'transfer'; const isR = record.type === 'return';
                                return (
                                    <div key={record.id} className="p-4 flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isA ? 'bg-emerald-50 dark:bg-emerald-950/30' : isT ? 'bg-violet-50 dark:bg-violet-950/30' : 'bg-amber-50 dark:bg-amber-950/30'}`}>
                                            {isA ? <UserPlus size={16} className="text-emerald-500" /> : isT ? <ArrowLeftRight size={16} className="text-violet-500" /> : <UserMinus size={16} className="text-amber-500" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${isA ? 'bg-emerald-100 text-emerald-600' : isT ? 'bg-violet-100 text-violet-600' : 'bg-amber-100 text-amber-600'}`}>
                                                {isA ? 'Cấp phát' : isT ? 'Luân chuyển' : 'Thu hồi'}
                                            </span>
                                            <div className="text-xs text-slate-500 mt-1">
                                                {isT ? (<><span className="font-bold">{record.fromUserName}</span> <ArrowRight size={10} className="inline mx-1 text-violet-400" /> <span className="font-bold text-violet-600">{record.userName}</span></>) :
                                                    (<>{isA ? 'Giao cho' : 'Thu hồi từ'}: <span className="font-bold">{record.userName}</span></>)}
                                            </div>
                                            {record.note && <p className="text-[10px] text-slate-400 italic mt-0.5">{record.note}</p>}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[10px] text-slate-400 font-bold">{new Date(record.date).toLocaleDateString('vi-VN')}</p>
                                            <p className="text-[9px] text-slate-300">bởi {record.performedByName}</p>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* ==================== MAINTENANCE TAB ==================== */}
            {activeTab === 'maintenance' && (
                <div className="space-y-4">
                    <div className="flex justify-end">
                        <button onClick={() => setShowAddMaintenance(true)}
                            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-black uppercase flex items-center gap-1.5 shadow-lg shadow-orange-500/20">
                            <Plus size={14} /> Thêm bảo trì
                        </button>
                    </div>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="text-xs font-black text-orange-600 uppercase flex items-center gap-1"><Wrench size={14} /> Lịch sử bảo trì ({maintenanceHistory.length})</h3>
                            <span className="text-xs font-black text-red-600">Tổng: {formatCurrency(costSummary.totalMaintenance)}</span>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {maintenanceHistory.length === 0 ? (
                                <div className="p-12 text-center">
                                    <Wrench size={40} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                                    <p className="text-slate-400 font-bold">Chưa có bảo trì</p>
                                </div>
                            ) : (
                                maintenanceHistory.map(m => (
                                    <div key={m.id} className="p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${m.type === 'repair' ? 'bg-red-50 dark:bg-red-950/30' : m.type === 'inspection' ? 'bg-blue-50 dark:bg-blue-950/30' : 'bg-orange-50 dark:bg-orange-950/30'}`}>
                                            <Wrench size={16} className={m.type === 'repair' ? 'text-red-500' : m.type === 'inspection' ? 'text-blue-500' : 'text-orange-500'} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${m.type === 'repair' ? 'bg-red-100 text-red-600' : m.type === 'inspection' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                                                    {TYPE_LABELS[m.type]}
                                                </span>
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${m.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : m.status === 'in_progress' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                                    {STATUS_LABELS[m.status]}
                                                </span>
                                                {(m.attachments?.length || 0) > 0 && <span className="text-[9px] font-bold text-blue-500 flex items-center gap-0.5"><Paperclip size={9} />{m.attachments!.length}</span>}
                                            </div>
                                            <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{m.description}</p>
                                            {m.vendor && <p className="text-[10px] text-slate-400">Đơn vị: {m.vendor}</p>}
                                            {m.invoiceNumber && <p className="text-[10px] text-slate-400">HĐ: {m.invoiceNumber}</p>}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-sm font-black text-red-600">{formatCurrency(m.cost)}</p>
                                            <p className="text-[10px] text-slate-400">{new Date(m.startDate).toLocaleDateString('vi-VN')}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== COSTS TAB ==================== */}
            {activeTab === 'costs' && (
                <div className="space-y-4">
                    {/* Cost summary cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm">
                            <p className="text-[9px] text-slate-400 font-bold uppercase">Nguyên giá mua</p>
                            <p className="text-xl font-black text-slate-800 dark:text-white mt-1">{formatCurrency(asset.originalValue)}</p>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm">
                            <p className="text-[9px] text-red-400 font-bold uppercase">Tổng chi phí BT/SC</p>
                            <p className="text-xl font-black text-red-600 mt-1">{formatCurrency(costSummary.totalMaintenance)}</p>
                            <p className="text-[9px] text-slate-400">{costSummary.count} lần</p>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm">
                            <p className="text-[9px] text-orange-400 font-bold uppercase">Chi phí sửa chữa</p>
                            <p className="text-xl font-black text-orange-600 mt-1">{formatCurrency(costSummary.repairCost)}</p>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm">
                            <p className="text-[9px] text-blue-400 font-bold uppercase">Chi phí bảo trì ĐK</p>
                            <p className="text-xl font-black text-blue-600 mt-1">{formatCurrency(costSummary.scheduledCost)}</p>
                        </div>
                    </div>

                    {/* Total cost of ownership */}
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-700 rounded-2xl p-6 text-white shadow-lg">
                        <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Tổng chi phí sở hữu (TCO)</p>
                        <p className="text-3xl font-black">{formatCurrency(asset.originalValue + costSummary.totalMaintenance)}</p>
                        <div className="mt-3 flex gap-6 text-sm">
                            <div>
                                <p className="text-slate-400 text-[10px]">Mua</p>
                                <p className="font-bold">{formatCurrency(asset.originalValue)}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 text-[10px]">BT/SC</p>
                                <p className="font-bold text-red-400">+{formatCurrency(costSummary.totalMaintenance)}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 text-[10px]">Giá trị hiện tại</p>
                                <p className="font-bold text-emerald-400">{formatCurrency(Math.round(remaining))}</p>
                            </div>
                        </div>
                        {/* Visual bar breakdown */}
                        <div className="mt-4 h-4 rounded-full bg-slate-700 overflow-hidden flex">
                            <div className="h-full bg-blue-500" style={{ width: `${Math.round((asset.originalValue / (asset.originalValue + costSummary.totalMaintenance)) * 100)}%` }} title="Nguyên giá" />
                            <div className="h-full bg-red-500" style={{ width: `${Math.round((costSummary.totalMaintenance / (asset.originalValue + costSummary.totalMaintenance)) * 100)}%` }} title="Chi phí BT/SC" />
                        </div>
                        <div className="flex gap-4 mt-2 text-[9px]">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500" /> Nguyên giá</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500" /> Chi phí BT/SC</span>
                        </div>
                    </div>

                    {/* Cost breakdown table */}
                    {maintenanceHistory.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                                <h3 className="text-xs font-black text-slate-500 uppercase">Chi tiết chi phí</h3>
                            </div>
                            <table className="w-full text-sm">
                                <thead><tr className="border-b border-slate-100 dark:border-slate-800">
                                    <th className="text-left p-3 text-[10px] font-black text-slate-400 uppercase">Ngày</th>
                                    <th className="text-left p-3 text-[10px] font-black text-slate-400 uppercase">Loại</th>
                                    <th className="text-left p-3 text-[10px] font-black text-slate-400 uppercase">Mô tả</th>
                                    <th className="text-left p-3 text-[10px] font-black text-slate-400 uppercase">Số HĐ</th>
                                    <th className="text-right p-3 text-[10px] font-black text-slate-400 uppercase">Chi phí</th>
                                </tr></thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {maintenanceHistory.map(m => (
                                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <td className="p-3 text-xs text-slate-500">{new Date(m.startDate).toLocaleDateString('vi-VN')}</td>
                                            <td className="p-3"><span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${m.type === 'repair' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>{TYPE_LABELS[m.type]}</span></td>
                                            <td className="p-3 text-xs text-slate-700 dark:text-slate-300">{m.description}</td>
                                            <td className="p-3 text-xs text-slate-400 font-mono">{m.invoiceNumber || '—'}</td>
                                            <td className="p-3 text-right font-black text-red-600">{formatCurrency(m.cost)}</td>
                                        </tr>
                                    ))}
                                    <tr className="bg-slate-50 dark:bg-slate-800">
                                        <td colSpan={4} className="p-3 text-xs font-black text-slate-600 dark:text-slate-300 text-right">TỔNG CỘNG</td>
                                        <td className="p-3 text-right font-black text-red-600 text-base">{formatCurrency(costSummary.totalMaintenance)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ===================== ADD MAINTENANCE MODAL ===================== */}
            {showAddMaintenance && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowAddMaintenance(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2"><Wrench size={20} className="text-orange-500" /> Thêm bảo trì — {asset.name}</h3>
                            <button onClick={() => setShowAddMaintenance(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Loại</label>
                                    <select value={mForm.type} onChange={e => setMForm(f => ({ ...f, type: e.target.value as any }))} className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="repair">Sửa chữa</option><option value="scheduled">Bảo trì định kỳ</option><option value="inspection">Kiểm tra</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Chi phí (VNĐ)</label>
                                    <input type="number" value={mForm.cost} onChange={e => setMForm(f => ({ ...f, cost: Number(e.target.value) }))} className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mô tả *</label>
                                <textarea value={mForm.description} onChange={e => setMForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 resize-none" placeholder="Mô tả nội dung..." />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Đơn vị</label>
                                    <input type="text" value={mForm.vendor} onChange={e => setMForm(f => ({ ...f, vendor: e.target.value }))} className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Số HĐ</label>
                                    <input type="text" value={mForm.invoiceNumber} onChange={e => setMForm(f => ({ ...f, invoiceNumber: e.target.value }))} className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ngày</label>
                                <input type="date" value={mForm.startDate} onChange={e => setMForm(f => ({ ...f, startDate: e.target.value }))} className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500" />
                            </div>
                            {/* Attachments */}
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-2">Đính kèm hoá đơn</label>
                                <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx" className="hidden" onChange={handleFileUpload} />
                                <button onClick={() => fileRef.current?.click()} className="w-full p-3 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-center hover:border-orange-400 transition-colors">
                                    <Upload size={16} className="mx-auto text-slate-300 mb-1" /><p className="text-xs text-slate-400">Click để tải lên</p>
                                </button>
                                {mAttachments.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                        {mAttachments.map(att => (
                                            <div key={att.id} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                                                <Paperclip size={10} className="text-blue-500" />
                                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate flex-1">{att.name}</span>
                                                <button onClick={() => setMAttachments(p => p.filter(a => a.id !== att.id))} className="text-slate-400 hover:text-red-500"><X size={10} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={() => setShowAddMaintenance(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-bold text-sm">Hủy</button>
                            <button onClick={handleAddMaintenance} disabled={!mForm.description.trim()}
                                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-sm shadow-lg shadow-orange-500/20 disabled:opacity-50">
                                Lưu bảo trì
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetProfile;
