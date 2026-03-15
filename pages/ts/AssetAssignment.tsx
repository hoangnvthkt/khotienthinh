import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
    Search, Repeat, UserPlus, UserMinus, Calendar, User, X,
    ArrowRight, ArrowLeft, Clock, Filter, Landmark, CheckCircle
} from 'lucide-react';
import { Asset, AssetStatus, ASSET_STATUS_LABELS, AssetAssignment as AssetAssignmentType } from '../../types';

const AssetAssignment: React.FC = () => {
    const {
        assets, assetAssignments, assetCategories, users, user,
        addAssetAssignment, updateAsset,
    } = useApp();
    const toast = useToast();

    const [activeTab, setActiveTab] = useState<'assign' | 'history'>('assign');
    const [searchTerm, setSearchTerm] = useState('');
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [assignUserId, setAssignUserId] = useState('');
    const [assignNote, setAssignNote] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'assign' | 'return'>('all');

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

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || '';
    const getAssetName = (assetId: string) => assets.find(a => a.id === assetId);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <Repeat className="text-rose-500" size={24} /> Cấp phát / Thu hồi
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">Quản lý cấp phát và thu hồi tài sản cho nhân viên</p>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center"><CheckCircle size={18} className="text-emerald-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Sẵn sàng cấp phát</p>
                            <p className="text-xl font-black text-emerald-600">{assets.filter(a => a.status === AssetStatus.AVAILABLE).length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center"><User size={18} className="text-blue-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Đang được sử dụng</p>
                            <p className="text-xl font-black text-blue-600">{assignedAssets.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center"><UserPlus size={18} className="text-indigo-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Lần cấp phát</p>
                            <p className="text-xl font-black text-indigo-600">{assetAssignments.filter(a => a.type === 'assign').length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center"><UserMinus size={18} className="text-amber-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Lần thu hồi</p>
                            <p className="text-xl font-black text-amber-600">{assetAssignments.filter(a => a.type === 'return').length}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm w-fit">
                <button onClick={() => setActiveTab('assign')}
                    className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'assign' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/20' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20'}`}>
                    <Repeat size={13} className="inline mr-1.5" /> Cấp phát / Thu hồi
                </button>
                <button onClick={() => setActiveTab('history')}
                    className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/20' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20'}`}>
                    <Clock size={13} className="inline mr-1.5" /> Lịch sử
                </button>
            </div>

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

            {activeTab === 'history' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
                        <h3 className="text-xs font-black text-slate-500 uppercase">Lịch sử cấp phát / thu hồi</h3>
                        <div className="flex gap-1">
                            {(['all', 'assign', 'return'] as const).map(type => (
                                <button key={type} onClick={() => setFilterType(type)}
                                    className={`px-3 py-1 rounded-lg text-[10px] font-bold ${filterType === type ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-rose-500'}`}>
                                    {type === 'all' ? 'Tất cả' : type === 'assign' ? 'Cấp phát' : 'Thu hồi'}
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
                                return (
                                    <div key={record.id} className="p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isAssign ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-amber-50 dark:bg-amber-950/30'}`}>
                                            {isAssign ? <ArrowRight size={16} className="text-emerald-500" /> : <ArrowLeft size={16} className="text-amber-500" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${isAssign ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'}`}>
                                                    {isAssign ? 'Cấp phát' : 'Thu hồi'}
                                                </span>
                                                <span className="text-sm font-black text-slate-800 dark:text-white">{asset?.name || record.assetId}</span>
                                                <span className="text-[10px] font-mono text-slate-400">{asset?.code}</span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {isAssign ? 'Giao cho' : 'Thu hồi từ'}: <span className="font-bold text-slate-700 dark:text-slate-300">{record.userName}</span>
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
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowAssignModal(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
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
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowReturnModal(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
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
        </div>
    );
};

export default AssetAssignment;
