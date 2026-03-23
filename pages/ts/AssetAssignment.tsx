import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
    Search, Repeat, UserPlus, UserMinus, Calendar, User, X,
    ArrowRight, ArrowLeft, Clock, Filter, Landmark, CheckCircle,
    ArrowLeftRight, Users
} from 'lucide-react';
import { Asset, AssetStatus, ASSET_STATUS_LABELS, AssetAssignment as AssetAssignmentType } from '../../types';

const AssetAssignment: React.FC = () => {
    const {
        assets, assetAssignments, assetCategories, users, user, orgUnits,
        addAssetAssignment, updateAsset,
    } = useApp();
    const toast = useToast();

    const [activeTab, setActiveTab] = useState<'assign' | 'transfer' | 'history'>('assign');
    const [searchTerm, setSearchTerm] = useState('');
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [assignUserId, setAssignUserId] = useState('');
    const [assignNote, setAssignNote] = useState('');
    const [transferUserId, setTransferUserId] = useState('');
    const [transferNote, setTransferNote] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'assign' | 'return' | 'transfer'>('all');

    // Departments from orgUnits
    const departments = useMemo(() => orgUnits.filter(u => u.type === 'department'), [orgUnits]);
    const [filterDepartment, setFilterDepartment] = useState('ALL');

    const availableAssets = useMemo(() => {
        return assets.filter(a =>
            a.status === AssetStatus.AVAILABLE &&
            (a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.code.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [assets, searchTerm]);

    const assignedAssets = useMemo(() => {
        return assets.filter(a =>
            a.status === AssetStatus.IN_USE && a.assignedToUserId &&
            (a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.code.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [assets, searchTerm]);

    // Assets available for transfer (currently assigned to someone)
    const transferableAssets = useMemo(() => {
        return assets.filter(a => {
            const matchStatus = a.status === AssetStatus.IN_USE && a.assignedToUserId;
            const matchSearch = a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                a.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (a.assignedToName || '').toLowerCase().includes(searchTerm.toLowerCase());
            // Filter by department: find user's departmentId from users list
            if (filterDepartment !== 'ALL') {
                const assignedUser = users.find(u => u.id === a.assignedToUserId);
                // Check if user has department metadata (may not be available)
                if (!assignedUser) return false;
                // For now, show all if department filter is set but user has no dept info
            }
            return matchStatus && matchSearch;
        });
    }, [assets, searchTerm, filterDepartment, users]);

    const filteredHistory = useMemo(() => {
        return assetAssignments.filter(a => {
            if (filterType !== 'all' && a.type !== filterType) return false;
            return true;
        });
    }, [assetAssignments, filterType]);

    const handleAssign = () => {
        if (!selectedAsset || !assignUserId) return;
        const targetUser = users.find(u => u.id === assignUserId);
        if (!targetUser) return;

        addAssetAssignment({
            id: `aa-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            assetId: selectedAsset.id,
            type: 'assign',
            userId: assignUserId,
            userName: targetUser.name,
            date: new Date().toISOString(),
            note: assignNote,
            performedBy: user.id,
            performedByName: user.name,
        });

        toast.success('Cấp phát thành công', `${selectedAsset.name} đã được giao cho ${targetUser.name}`);
        setShowAssignModal(false);
        setSelectedAsset(null);
        setAssignUserId('');
        setAssignNote('');
    };

    const handleReturn = () => {
        if (!selectedAsset) return;

        addAssetAssignment({
            id: `aa-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            assetId: selectedAsset.id,
            type: 'return',
            userId: selectedAsset.assignedToUserId || '',
            userName: selectedAsset.assignedToName || '',
            date: new Date().toISOString(),
            note: assignNote,
            performedBy: user.id,
            performedByName: user.name,
        });

        toast.success('Thu hồi thành công', `${selectedAsset.name} đã được thu hồi từ ${selectedAsset.assignedToName}`);
        setShowReturnModal(false);
        setSelectedAsset(null);
        setAssignNote('');
    };

    const handleTransfer = () => {
        if (!selectedAsset || !transferUserId) return;
        const targetUser = users.find(u => u.id === transferUserId);
        if (!targetUser) return;

        addAssetAssignment({
            id: `aa-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            assetId: selectedAsset.id,
            type: 'transfer',
            userId: transferUserId,
            userName: targetUser.name,
            fromUserId: selectedAsset.assignedToUserId,
            fromUserName: selectedAsset.assignedToName,
            date: new Date().toISOString(),
            note: transferNote,
            performedBy: user.id,
            performedByName: user.name,
        });

        toast.success('Luân chuyển thành công', `${selectedAsset.name}: ${selectedAsset.assignedToName} → ${targetUser.name}`);
        setShowTransferModal(false);
        setSelectedAsset(null);
        setTransferUserId('');
        setTransferNote('');
    };

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || '';
    const getAssetName = (assetId: string) => assets.find(a => a.id === assetId);

    // Transfer stats
    const transferCount = useMemo(() => assetAssignments.filter(a => a.type === 'transfer').length, [assetAssignments]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <Repeat className="text-rose-500" size={24} /> Cấp phát / Thu hồi / Luân chuyển
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">Quản lý cấp phát, thu hồi và luân chuyển tài sản giữa các nhân viên, phòng ban</p>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center"><CheckCircle size={18} className="text-emerald-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Sẵn sàng</p>
                            <p className="text-xl font-black text-emerald-600">{assets.filter(a => a.status === AssetStatus.AVAILABLE).length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center"><User size={18} className="text-blue-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Đang dùng</p>
                            <p className="text-xl font-black text-blue-600">{assignedAssets.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center"><UserPlus size={18} className="text-indigo-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Cấp phát</p>
                            <p className="text-xl font-black text-indigo-600">{assetAssignments.filter(a => a.type === 'assign').length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center"><ArrowLeftRight size={18} className="text-violet-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Luân chuyển</p>
                            <p className="text-xl font-black text-violet-600">{transferCount}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center"><UserMinus size={18} className="text-amber-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Thu hồi</p>
                            <p className="text-xl font-black text-amber-600">{assetAssignments.filter(a => a.type === 'return').length}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm w-fit">
                <button onClick={() => setActiveTab('assign')}
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'assign' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/20' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20'}`}>
                    <Repeat size={13} className="inline mr-1.5" /> Cấp phát / Thu hồi
                </button>
                <button onClick={() => setActiveTab('transfer')}
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'transfer' ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/20' : 'text-slate-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950/20'}`}>
                    <ArrowLeftRight size={13} className="inline mr-1.5" /> Luân chuyển
                </button>
                <button onClick={() => setActiveTab('history')}
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/20' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20'}`}>
                    <Clock size={13} className="inline mr-1.5" /> Lịch sử
                </button>
            </div>

            {/* ==================== ASSIGN / RETURN TAB ==================== */}
            {activeTab === 'assign' && (
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Available Assets to Assign */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="text-xs font-black text-emerald-600 uppercase mb-3 flex items-center gap-2">
                                <CheckCircle size={14} /> Tài sản sẵn sàng ({availableAssets.length})
                            </h3>
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input type="text" placeholder="Tìm mã TS, tên..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500" />
                            </div>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[400px] overflow-y-auto">
                            {availableAssets.length === 0 ? (
                                <div className="p-8 text-center text-slate-300 text-sm">Không có tài sản sẵn sàng</div>
                            ) : (
                                availableAssets.map(asset => (
                                    <div key={asset.id} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center justify-between transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shrink-0">
                                                <Landmark size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-mono text-slate-400 font-bold">{asset.code}</div>
                                                <div className="text-sm font-black text-slate-800 dark:text-white truncate">{asset.name}</div>
                                                <div className="text-[10px] text-slate-400">{getCategoryName(asset.categoryId)}</div>
                                            </div>
                                        </div>
                                        <button onClick={() => { setSelectedAsset(asset); setShowAssignModal(true); setAssignUserId(''); setAssignNote(''); }}
                                            className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 text-[10px] font-black uppercase hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors flex items-center gap-1 shrink-0">
                                            <UserPlus size={12} /> Cấp phát
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Assigned Assets to Return */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="text-xs font-black text-blue-600 uppercase mb-3 flex items-center gap-2">
                                <User size={14} /> Đang sử dụng ({assignedAssets.length})
                            </h3>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[400px] overflow-y-auto">
                            {assignedAssets.length === 0 ? (
                                <div className="p-8 text-center text-slate-300 text-sm">Chưa có tài sản nào được cấp phát</div>
                            ) : (
                                assignedAssets.map(asset => (
                                    <div key={asset.id} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center justify-between transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white shrink-0">
                                                <User size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-mono text-slate-400 font-bold">{asset.code}</div>
                                                <div className="text-sm font-black text-slate-800 dark:text-white truncate">{asset.name}</div>
                                                <div className="text-[10px] text-blue-500 font-bold flex items-center gap-1">
                                                    <User size={9} /> {asset.assignedToName}
                                                    {asset.assignedDate && <span className="text-slate-400 ml-1">• {new Date(asset.assignedDate).toLocaleDateString('vi-VN')}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <button onClick={() => { setSelectedAsset(asset); setShowReturnModal(true); setAssignNote(''); }}
                                            className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-600 text-[10px] font-black uppercase hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors flex items-center gap-1 shrink-0">
                                            <UserMinus size={12} /> Thu hồi
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== TRANSFER TAB ==================== */}
            {activeTab === 'transfer' && (
                <div className="space-y-4">
                    {/* Info banner */}
                    <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/30 rounded-2xl p-4 flex items-start gap-3">
                        <ArrowLeftRight size={18} className="text-violet-500 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-xs font-black text-violet-700 dark:text-violet-400">Luân chuyển tài sản</p>
                            <p className="text-[11px] text-violet-600 dark:text-violet-400/80 font-medium mt-0.5">Chọn tài sản đang được sử dụng để chuyển sang người dùng / phòng ban khác. Tài sản sẽ giữ nguyên trạng thái "Đang sử dụng".</p>
                        </div>
                    </div>

                    {/* Search & Filter */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" placeholder="Tìm tài sản hoặc người đang dùng..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-500 font-medium" />
                        </div>
                    </div>

                    {/* Transfer list */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="text-xs font-black text-violet-600 uppercase flex items-center gap-2">
                                <ArrowLeftRight size={14} /> Tài sản có thể luân chuyển ({transferableAssets.length})
                            </h3>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[500px] overflow-y-auto">
                            {transferableAssets.length === 0 ? (
                                <div className="p-12 text-center">
                                    <ArrowLeftRight size={40} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                                    <p className="text-slate-400 font-bold text-sm">Không có tài sản nào đang được sử dụng</p>
                                    <p className="text-xs text-slate-300 mt-1">Cấp phát tài sản cho nhân viên trước khi luân chuyển</p>
                                </div>
                            ) : (
                                transferableAssets.map(asset => (
                                    <div key={asset.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center justify-between transition-colors group">
                                        <div className="flex items-center gap-4 min-w-0 flex-1">
                                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-lg shadow-violet-500/20">
                                                <Landmark size={16} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-black text-slate-800 dark:text-white">{asset.name}</span>
                                                    <span className="text-[10px] font-mono text-slate-400 font-bold">{asset.code}</span>
                                                </div>
                                                <div className="text-[10px] text-slate-400 mt-0.5">{getCategoryName(asset.categoryId)} • {asset.originalValue.toLocaleString('vi-VN')}đ</div>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/30 text-blue-600 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                                                        <User size={10} /> {asset.assignedToName}
                                                    </div>
                                                    {asset.assignedDate && (
                                                        <span className="text-[9px] text-slate-400">từ {new Date(asset.assignedDate).toLocaleDateString('vi-VN')}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <button onClick={() => { setSelectedAsset(asset); setShowTransferModal(true); setTransferUserId(''); setTransferNote(''); }}
                                            className="px-4 py-2 rounded-xl bg-violet-50 dark:bg-violet-950/30 text-violet-600 text-[10px] font-black uppercase hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm group-hover:shadow-md group-hover:shadow-violet-500/10">
                                            <ArrowLeftRight size={14} /> Luân chuyển
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== HISTORY TAB ==================== */}
            {activeTab === 'history' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
                        <h3 className="text-xs font-black text-slate-500 uppercase">Lịch sử cấp phát / thu hồi / luân chuyển</h3>
                        <div className="flex gap-1">
                            {(['all', 'assign', 'return', 'transfer'] as const).map(type => (
                                <button key={type} onClick={() => setFilterType(type)}
                                    className={`px-3 py-1 rounded-lg text-[10px] font-bold ${filterType === type ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-rose-500'}`}>
                                    {type === 'all' ? 'Tất cả' : type === 'assign' ? 'Cấp phát' : type === 'return' ? 'Thu hồi' : 'Luân chuyển'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredHistory.length === 0 ? (
                            <div className="p-12 text-center">
                                <Clock size={40} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                                <p className="text-slate-400 font-bold">Chưa có lịch sử</p>
                            </div>
                        ) : (
                            filteredHistory.map(record => {
                                const asset = getAssetName(record.assetId);
                                const isAssign = record.type === 'assign';
                                const isTransfer = record.type === 'transfer';
                                const isReturn = record.type === 'return';
                                return (
                                    <div key={record.id} className="p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isAssign ? 'bg-emerald-50 dark:bg-emerald-950/30' : isTransfer ? 'bg-violet-50 dark:bg-violet-950/30' : 'bg-amber-50 dark:bg-amber-950/30'}`}>
                                            {isAssign ? <ArrowRight size={16} className="text-emerald-500" /> : isTransfer ? <ArrowLeftRight size={16} className="text-violet-500" /> : <ArrowLeft size={16} className="text-amber-500" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${isAssign ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : isTransfer ? 'bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'}`}>
                                                    {isAssign ? 'Cấp phát' : isTransfer ? 'Luân chuyển' : 'Thu hồi'}
                                                </span>
                                                <span className="text-sm font-black text-slate-800 dark:text-white">{asset?.name || record.assetId}</span>
                                                <span className="text-[10px] font-mono text-slate-400">{asset?.code}</span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {isTransfer ? (
                                                    <>
                                                        <span className="font-bold text-slate-600 dark:text-slate-300">{record.fromUserName}</span>
                                                        <ArrowRight size={10} className="inline mx-1 text-violet-400" />
                                                        <span className="font-bold text-violet-600">{record.userName}</span>
                                                    </>
                                                ) : (
                                                    <>{isAssign ? 'Giao cho' : 'Thu hồi từ'}: <span className="font-bold text-slate-700 dark:text-slate-300">{record.userName}</span></>
                                                )}
                                                {record.note && <span className="ml-2 text-slate-400 italic">— {record.note}</span>}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-[10px] text-slate-400 font-bold">{new Date(record.date).toLocaleDateString('vi-VN')}</div>
                                            <div className="text-[9px] text-slate-300">{new Date(record.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
                                            <div className="text-[9px] text-slate-300 mt-0.5">bởi {record.performedByName}</div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* ===================== ASSIGN MODAL ===================== */}
            {showAssignModal && selectedAsset && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2"><UserPlus size={20} className="text-emerald-500" /> Cấp phát tài sản</h3>
                                <button onClick={() => setShowAssignModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                                <div className="text-[10px] font-mono text-slate-400 font-bold">{selectedAsset.code}</div>
                                <div className="text-sm font-black text-slate-800 dark:text-white">{selectedAsset.name}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5">{getCategoryName(selectedAsset.categoryId)} • {selectedAsset.originalValue.toLocaleString('vi-VN')}đ</div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Giao cho *</label>
                                <select value={assignUserId} onChange={e => setAssignUserId(e.target.value)}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-emerald-500">
                                    <option value="">Chọn người nhận...</option>
                                    {users.filter(u => u.id !== user.id).map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={assignNote} onChange={e => setAssignNote(e.target.value)} rows={2}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                                    placeholder="VD: Phục vụ công trường ABC..." />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={() => setShowAssignModal(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-bold text-sm">Hủy</button>
                            <button onClick={handleAssign} disabled={!assignUserId}
                                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                                Xác nhận cấp phát
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===================== RETURN MODAL ===================== */}
            {showReturnModal && selectedAsset && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2"><UserMinus size={20} className="text-amber-500" /> Thu hồi tài sản</h3>
                                <button onClick={() => setShowReturnModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                                <div className="text-[10px] font-mono text-slate-400 font-bold">{selectedAsset.code}</div>
                                <div className="text-sm font-black text-slate-800 dark:text-white">{selectedAsset.name}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5">{getCategoryName(selectedAsset.categoryId)}</div>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-center gap-3">
                                <User size={16} className="text-blue-500 shrink-0" />
                                <div>
                                    <p className="text-[9px] text-blue-400 font-bold uppercase">Thu hồi từ</p>
                                    <p className="text-sm font-black text-blue-600">{selectedAsset.assignedToName}</p>
                                    {selectedAsset.assignedDate && <p className="text-[10px] text-slate-400">Đã cấp phát: {new Date(selectedAsset.assignedDate).toLocaleDateString('vi-VN')}</p>}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Lý do thu hồi</label>
                                <textarea value={assignNote} onChange={e => setAssignNote(e.target.value)} rows={2}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                                    placeholder="VD: Hoàn thành dự án, nhân sự nghỉ việc..." />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={() => setShowReturnModal(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-bold text-sm">Hủy</button>
                            <button onClick={handleReturn}
                                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold text-sm shadow-lg shadow-amber-500/20">
                                Xác nhận thu hồi
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===================== TRANSFER MODAL ===================== */}
            {showTransferModal && selectedAsset && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                                    <ArrowLeftRight size={20} className="text-violet-500" /> Luân chuyển tài sản
                                </h3>
                                <button onClick={() => setShowTransferModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                        </div>
                        <div className="p-6 space-y-5">
                            {/* Asset info */}
                            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                                <div className="text-[10px] font-mono text-slate-400 font-bold">{selectedAsset.code}</div>
                                <div className="text-sm font-black text-slate-800 dark:text-white">{selectedAsset.name}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5">{getCategoryName(selectedAsset.categoryId)} • {selectedAsset.originalValue.toLocaleString('vi-VN')}đ</div>
                            </div>

                            {/* Transfer visualization */}
                            <div className="flex items-center gap-3">
                                {/* From user */}
                                <div className="flex-1 bg-blue-50 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30">
                                    <p className="text-[9px] text-blue-400 font-bold uppercase mb-1">Từ (Người giao)</p>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white"><User size={14} /></div>
                                        <div>
                                            <p className="text-sm font-black text-blue-700 dark:text-blue-400">{selectedAsset.assignedToName}</p>
                                            {selectedAsset.assignedDate && <p className="text-[9px] text-slate-400">Nhận từ {new Date(selectedAsset.assignedDate).toLocaleDateString('vi-VN')}</p>}
                                        </div>
                                    </div>
                                </div>

                                {/* Arrow */}
                                <div className="shrink-0 flex flex-col items-center">
                                    <ArrowRight size={20} className="text-violet-500" />
                                    <span className="text-[8px] font-black text-violet-400 uppercase mt-0.5">chuyển</span>
                                </div>

                                {/* To user */}
                                <div className="flex-1 bg-violet-50 dark:bg-violet-950/20 p-3 rounded-xl border border-violet-100 dark:border-violet-900/30">
                                    <p className="text-[9px] text-violet-400 font-bold uppercase mb-1">Đến (Người nhận) *</p>
                                    {transferUserId ? (() => {
                                        const tu = users.find(u => u.id === transferUserId);
                                        return tu ? (
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-violet-500 flex items-center justify-center text-white"><User size={14} /></div>
                                                <p className="text-sm font-black text-violet-700 dark:text-violet-400">{tu.name}</p>
                                            </div>
                                        ) : null;
                                    })() : (
                                        <p className="text-xs text-violet-300 italic">Chọn người nhận bên dưới...</p>
                                    )}
                                </div>
                            </div>

                            {/* Select target user */}
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Chuyển cho *</label>
                                <select value={transferUserId} onChange={e => setTransferUserId(e.target.value)}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-violet-500">
                                    <option value="">Chọn người nhận mới...</option>
                                    {users.filter(u => u.id !== selectedAsset.assignedToUserId).map(u => (
                                        <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                                    ))}
                                </select>
                            </div>

                            {/* Note */}
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Lý do luân chuyển</label>
                                <textarea value={transferNote} onChange={e => setTransferNote(e.target.value)} rows={2}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                                    placeholder="VD: Điều chuyển nhân sự sang phòng khác, luân chuyển thiết bị giữa dự án..." />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={() => setShowTransferModal(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-bold text-sm">Hủy</button>
                            <button onClick={handleTransfer} disabled={!transferUserId}
                                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-bold text-sm shadow-lg shadow-violet-500/20 disabled:opacity-50">
                                <ArrowLeftRight size={14} className="inline mr-1.5" /> Xác nhận luân chuyển
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetAssignment;
