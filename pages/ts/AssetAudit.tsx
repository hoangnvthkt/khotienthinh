import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
    ClipboardCheck, Search, Save, CheckCircle2, History,
    AlertCircle, Eye, Calendar, Download, ChevronLeft,
    Shield, Landmark, XCircle, MapPin, AlertTriangle
} from 'lucide-react';
import { AssetStatus, ASSET_STATUS_LABELS } from '../../types';
import * as XLSX from 'xlsx';

type AssetCondition = 'good' | 'damaged' | 'lost' | 'wrong_location';
const CONDITION_LABELS: Record<AssetCondition, string> = {
    good: 'Tốt',
    damaged: 'Hư hỏng',
    lost: 'Mất',
    wrong_location: 'Sai vị trí'
};
const CONDITION_COLORS: Record<AssetCondition, string> = {
    good: 'text-emerald-600 bg-emerald-50',
    damaged: 'text-orange-600 bg-orange-50',
    lost: 'text-red-600 bg-red-50',
    wrong_location: 'text-blue-600 bg-blue-50'
};

interface AssetAuditItem {
    assetId: string;
    assetName: string;
    assetCode: string;
    categoryName: string;
    expectedStatus: AssetStatus;
    actualCondition: AssetCondition;
    expectedLocation: string;
    actualLocation?: string;
    note?: string;
}

interface AssetAuditSession {
    id: string;
    date: string;
    auditorName: string;
    items: AssetAuditItem[];
    totalItems: number;
    totalGood: number;
    totalDamaged: number;
    totalLost: number;
    totalWrongLocation: number;
}

const AssetAudit: React.FC = () => {
    const { assets, assetCategories, users, user } = useApp();
    const toast = useToast();
    const [activeView, setActiveView] = useState<'audit' | 'history'>('audit');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('ALL');
    const [isSaving, setIsSaving] = useState(false);

    // Audit data
    const [auditData, setAuditData] = useState<Record<string, AssetCondition>>({});
    const [auditNotes, setAuditNotes] = useState<Record<string, string>>({});
    const [auditLocations, setAuditLocations] = useState<Record<string, string>>({});

    // Session history (stored locally)
    const [sessions, setSessions] = useState<AssetAuditSession[]>([]);
    const [viewingSession, setViewingSession] = useState<AssetAuditSession | null>(null);

    const filteredAssets = useMemo(() => {
        return assets.filter(a => {
            const matchesSearch = a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                a.code.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = filterCategory === 'ALL' || a.categoryId === filterCategory;
            return matchesSearch && matchesCategory;
        });
    }, [assets, searchTerm, filterCategory]);

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || 'Khác';

    const stats = useMemo(() => {
        const audited = Object.keys(auditData).length;
        const good = Object.values(auditData).filter(v => v === 'good').length;
        const damaged = Object.values(auditData).filter(v => v === 'damaged').length;
        const lost = Object.values(auditData).filter(v => v === 'lost').length;
        const wrongLocation = Object.values(auditData).filter(v => v === 'wrong_location').length;
        return { audited, good, damaged, lost, wrongLocation };
    }, [auditData]);

    const handleSaveAudit = () => {
        if (Object.keys(auditData).length === 0) return;
        setIsSaving(true);

        const items: AssetAuditItem[] = Object.entries(auditData).map(([assetId, condition]: [string, AssetCondition]) => {
            const asset = assets.find(a => a.id === assetId)!;
            return {
                assetId,
                assetName: asset.name,
                assetCode: asset.code,
                categoryName: getCategoryName(asset.categoryId),
                expectedStatus: asset.status,
                actualCondition: condition,
                expectedLocation: asset.assignedToName || 'Kho',
                actualLocation: auditLocations[assetId] || undefined,
                note: auditNotes[assetId] || undefined
            };
        });

        const session: AssetAuditSession = {
            id: `tsaudit-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            date: new Date().toISOString(),
            auditorName: user.name || user.username,
            items,
            totalItems: items.length,
            totalGood: items.filter(i => i.actualCondition === 'good').length,
            totalDamaged: items.filter(i => i.actualCondition === 'damaged').length,
            totalLost: items.filter(i => i.actualCondition === 'lost').length,
            totalWrongLocation: items.filter(i => i.actualCondition === 'wrong_location').length,
        };

        setTimeout(() => {
            setSessions(prev => [session, ...prev]);
            setAuditData({});
            setAuditNotes({});
            setAuditLocations({});
            setIsSaving(false);
            toast.success('Kiểm kê thành công', 'Dữ liệu đã được lưu. Xem chi tiết tại tab "Lịch sử".');
        }, 800);
    };

    const exportSessionToExcel = (session: AssetAuditSession) => {
        const wsData = [
            ['BÁO CÁO KIỂM KÊ TÀI SẢN'],
            [],
            ['Ngày kiểm kê:', new Date(session.date).toLocaleString('vi-VN')],
            ['Người kiểm kê:', session.auditorName],
            ['Tổng tài sản kiểm:', session.totalItems],
            ['Tình trạng tốt:', session.totalGood],
            ['Hư hỏng:', session.totalDamaged],
            ['Mất:', session.totalLost],
            ['Sai vị trí:', session.totalWrongLocation],
            [],
            ['STT', 'Mã TS', 'Tên tài sản', 'Phân loại', 'Trạng thái HT', 'Tình trạng thực tế', 'Vị trí dự kiến', 'Vị trí thực tế', 'Ghi chú']
        ];

        session.items.forEach((item, idx) => {
            wsData.push([
                (idx + 1) as any,
                item.assetCode,
                item.assetName,
                item.categoryName,
                ASSET_STATUS_LABELS[item.expectedStatus],
                CONDITION_LABELS[item.actualCondition],
                item.expectedLocation,
                item.actualLocation || '',
                item.note || ''
            ]);
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
            { wch: 5 }, { wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 15 },
            { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 25 }
        ];
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
        XLSX.utils.book_append_sheet(wb, ws, 'Kiểm kê TS');

        const d = new Date(session.date);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const fileName = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} kiemke_taisan.xlsx`;

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('Xuất Excel', `Đã tải file ${fileName}`);
    };

    // ============== SESSION DETAIL VIEW ==============
    if (viewingSession) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <button onClick={() => setViewingSession(null)} className="flex items-center px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition font-bold text-xs">
                        <ChevronLeft size={16} className="mr-1" /> Quay lại
                    </button>
                    <div className="flex-1">
                        <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">Chi tiết kiểm kê tài sản</h1>
                        <p className="text-slate-500 text-sm font-medium">{new Date(viewingSession.date).toLocaleString('vi-VN')} — {viewingSession.auditorName}</p>
                    </div>
                    <button onClick={() => exportSessionToExcel(viewingSession)} className="flex items-center px-5 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-500/20">
                        <Download size={16} className="mr-2" /> Xuất Excel
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Tổng kiểm</div>
                        <div className="text-2xl font-black text-slate-800 dark:text-white mt-1">{viewingSession.totalItems}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <div className="text-[10px] font-black uppercase text-emerald-500 tracking-widest">Tốt</div>
                        <div className="text-2xl font-black text-emerald-600 mt-1">{viewingSession.totalGood}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <div className="text-[10px] font-black uppercase text-orange-500 tracking-widest">Hư hỏng</div>
                        <div className="text-2xl font-black text-orange-600 mt-1">{viewingSession.totalDamaged}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <div className="text-[10px] font-black uppercase text-red-500 tracking-widest">Mất</div>
                        <div className="text-2xl font-black text-red-600 mt-1">{viewingSession.totalLost}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <div className="text-[10px] font-black uppercase text-blue-500 tracking-widest">Sai vị trí</div>
                        <div className="text-2xl font-black text-blue-600 mt-1">{viewingSession.totalWrongLocation}</div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-[10px] uppercase font-black tracking-widest text-slate-400">
                                    <th className="p-4">STT</th>
                                    <th className="p-4">Tài sản</th>
                                    <th className="p-4">Phân loại</th>
                                    <th className="p-4 text-center">Trạng thái HT</th>
                                    <th className="p-4 text-center">Tình trạng thực tế</th>
                                    <th className="p-4">Vị trí</th>
                                    <th className="p-4">Ghi chú</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {viewingSession.items.map((item, idx) => (
                                    <tr key={item.assetId} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition ${item.actualCondition !== 'good' ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}`}>
                                        <td className="p-4 text-sm font-bold text-slate-400">{idx + 1}</td>
                                        <td className="p-4">
                                            <div className="font-black text-sm text-slate-800 dark:text-white">{item.assetName}</div>
                                            <div className="text-[10px] font-bold text-slate-400 font-mono">{item.assetCode}</div>
                                        </td>
                                        <td className="p-4 text-sm text-slate-600 dark:text-slate-400 font-bold">{item.categoryName}</td>
                                        <td className="p-4 text-center">
                                            <span className="text-[10px] font-black uppercase">{ASSET_STATUS_LABELS[item.expectedStatus]}</span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${CONDITION_COLORS[item.actualCondition]}`}>
                                                {CONDITION_LABELS[item.actualCondition]}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="text-xs text-slate-500">{item.expectedLocation}</div>
                                            {item.actualLocation && <div className="text-xs text-blue-600 font-bold">→ {item.actualLocation}</div>}
                                        </td>
                                        <td className="p-4 text-xs text-slate-500">{item.note || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    // ============== MAIN VIEW ==============
    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <ClipboardCheck className="text-rose-500" size={24} /> Kiểm kê tài sản
                    </h1>
                    <p className="text-slate-500 text-sm font-medium">Đối soát tình trạng tài sản thực tế và hệ thống.</p>
                </div>
                <div className="flex gap-2">
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-1 flex gap-1">
                        <button onClick={() => setActiveView('audit')} className={`px-4 py-2 rounded-lg text-xs font-bold transition ${activeView === 'audit' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                            <ClipboardCheck size={14} className="inline mr-1.5" />Kiểm kê
                        </button>
                        <button onClick={() => setActiveView('history')} className={`px-4 py-2 rounded-lg text-xs font-bold transition ${activeView === 'history' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                            <History size={14} className="inline mr-1.5" />Lịch sử ({sessions.length})
                        </button>
                    </div>
                    {activeView === 'audit' && (
                        <button disabled={Object.keys(auditData).length === 0 || isSaving} onClick={handleSaveAudit}
                            className="flex items-center px-6 py-2.5 bg-rose-500 text-white rounded-xl hover:bg-rose-600 transition font-black uppercase text-[10px] tracking-widest shadow-lg shadow-rose-500/20 disabled:opacity-50 disabled:shadow-none">
                            {isSaving ? 'Đang lưu...' : <><Save size={16} className="mr-2" /> Hoàn tất</>}
                        </button>
                    )}
                </div>
            </div>

            {/* ==================== HISTORY TAB ==================== */}
            {activeView === 'history' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center">
                            <History size={20} className="mr-2 text-rose-500" /> Lịch sử kiểm kê tài sản
                        </h2>
                        <p className="text-xs text-slate-500 font-medium mt-1">Tất cả phiên kiểm kê đã hoàn thành.</p>
                    </div>
                    {sessions.length === 0 ? (
                        <div className="p-16 text-center text-slate-300">
                            <ClipboardCheck size={48} className="mx-auto opacity-20 mb-4" />
                            <p className="font-black uppercase tracking-widest text-sm">Chưa có lịch sử kiểm kê</p>
                            <p className="text-xs font-medium mt-1">Hoàn tất phiên kiểm kê đầu tiên để lưu lịch sử.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 text-[10px] uppercase font-black tracking-widest text-slate-400">
                                        <th className="p-4">Ngày kiểm kê</th>
                                        <th className="p-4">Người kiểm kê</th>
                                        <th className="p-4 text-center">Tổng</th>
                                        <th className="p-4 text-center">Tốt</th>
                                        <th className="p-4 text-center">Hư hỏng</th>
                                        <th className="p-4 text-center">Mất</th>
                                        <th className="p-4 text-center">Sai vị trí</th>
                                        <th className="p-4 text-center">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {sessions.map(session => (
                                        <tr key={session.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <Calendar size={14} className="text-rose-400" />
                                                    <div>
                                                        <div className="font-bold text-sm text-slate-800 dark:text-white">{new Date(session.date).toLocaleDateString('vi-VN')}</div>
                                                        <div className="text-[10px] text-slate-400 font-medium">{new Date(session.date).toLocaleTimeString('vi-VN')}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4"><span className="text-sm font-medium text-slate-600 dark:text-slate-400">{session.auditorName}</span></td>
                                            <td className="p-4 text-center"><span className="font-black text-slate-800 dark:text-white">{session.totalItems}</span></td>
                                            <td className="p-4 text-center"><span className="font-black text-emerald-600">{session.totalGood}</span></td>
                                            <td className="p-4 text-center">
                                                {session.totalDamaged > 0 ? <span className="bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full text-[10px] font-black">{session.totalDamaged}</span> : <span className="text-slate-300">0</span>}
                                            </td>
                                            <td className="p-4 text-center">
                                                {session.totalLost > 0 ? <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-black">{session.totalLost}</span> : <span className="text-slate-300">0</span>}
                                            </td>
                                            <td className="p-4 text-center">
                                                {session.totalWrongLocation > 0 ? <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-[10px] font-black">{session.totalWrongLocation}</span> : <span className="text-slate-300">0</span>}
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button onClick={() => setViewingSession(session)} className="flex items-center px-3 py-1.5 bg-blue-50 dark:bg-blue-950/20 text-blue-600 rounded-lg hover:bg-blue-100 transition text-[10px] font-bold">
                                                        <Eye size={12} className="mr-1" /> Xem
                                                    </button>
                                                    <button onClick={() => exportSessionToExcel(session)} className="flex items-center px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 rounded-lg hover:bg-emerald-100 transition text-[10px] font-bold">
                                                        <Download size={12} className="mr-1" /> Excel
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ==================== AUDIT TAB ==================== */}
            {activeView === 'audit' && (
                <>
                    {/* Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <ClipboardCheck size={16} className="text-slate-400" />
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase">Đã kiểm</p>
                                    <p className="text-xl font-black text-slate-800 dark:text-white">{stats.audited}<span className="text-sm text-slate-400">/{assets.length}</span></p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 size={16} className="text-emerald-500" />
                                <div>
                                    <p className="text-[10px] font-black text-emerald-500 uppercase">Tốt</p>
                                    <p className="text-xl font-black text-emerald-600">{stats.good}</p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <AlertTriangle size={16} className="text-orange-500" />
                                <div>
                                    <p className="text-[10px] font-black text-orange-500 uppercase">Hư hỏng</p>
                                    <p className="text-xl font-black text-orange-600">{stats.damaged}</p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <XCircle size={16} className="text-red-500" />
                                <div>
                                    <p className="text-[10px] font-black text-red-500 uppercase">Mất</p>
                                    <p className="text-xl font-black text-red-600">{stats.lost}</p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <MapPin size={16} className="text-blue-500" />
                                <div>
                                    <p className="text-[10px] font-black text-blue-500 uppercase">Sai vị trí</p>
                                    <p className="text-xl font-black text-blue-600">{stats.wrongLocation}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Filter + Search */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                            <input type="text" placeholder="Tìm tài sản theo tên hoặc mã..."
                                className="w-full pl-10 pr-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-rose-500 font-medium bg-slate-50 dark:bg-slate-800"
                                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                            className="px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500 bg-slate-50 dark:bg-slate-800 min-w-[180px]">
                            <option value="ALL">Tất cả loại</option>
                            {assetCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {/* Audit Table */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[900px]">
                                <thead>
                                    <tr className="bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                                        <th className="p-4">Tài sản</th>
                                        <th className="p-4">Phân loại</th>
                                        <th className="p-4 text-center">Trạng thái HT</th>
                                        <th className="p-4 text-center">Tình trạng thực tế</th>
                                        <th className="p-4">Ghi chú</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {filteredAssets.map(asset => {
                                        const condition = auditData[asset.id];
                                        const hasInput = condition !== undefined;
                                        const isIssue = hasInput && condition !== 'good';

                                        return (
                                            <tr key={asset.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${isIssue ? 'bg-amber-50/30 dark:bg-amber-950/10' : hasInput ? 'bg-emerald-50/20 dark:bg-emerald-950/10' : ''}`}>
                                                <td className="p-4">
                                                    <div className="font-black text-slate-800 dark:text-white text-sm">{asset.name}</div>
                                                    <div className="text-[10px] font-bold text-slate-400 font-mono">{asset.code}</div>
                                                    {asset.assignedToName && <div className="text-[10px] text-blue-500 font-bold mt-0.5">👤 {asset.assignedToName}</div>}
                                                </td>
                                                <td className="p-4 text-sm text-slate-600 dark:text-slate-400 font-bold">{getCategoryName(asset.categoryId)}</td>
                                                <td className="p-4 text-center">
                                                    <span className="text-[10px] font-bold text-slate-500">{ASSET_STATUS_LABELS[asset.status]}</span>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <select value={condition || ''} onChange={e => {
                                                        if (e.target.value) {
                                                            setAuditData(prev => ({ ...prev, [asset.id]: e.target.value as AssetCondition }));
                                                        } else {
                                                            setAuditData(prev => { const n = { ...prev }; delete n[asset.id]; return n; });
                                                        }
                                                    }} className={`px-3 py-1.5 text-[11px] font-bold border rounded-lg outline-none focus:ring-2 focus:ring-rose-500 ${hasInput ? 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800' : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800'}`}>
                                                        <option value="">-- Chọn --</option>
                                                        {Object.entries(CONDITION_LABELS).map(([key, label]) => (
                                                            <option key={key} value={key}>{label}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="p-4">
                                                    {hasInput && (
                                                        <input type="text" placeholder="Ghi chú..."
                                                            value={auditNotes[asset.id] || ''}
                                                            onChange={e => setAuditNotes(prev => ({ ...prev, [asset.id]: e.target.value }))}
                                                            className="w-full px-2 py-1 text-[10px] border border-slate-200 dark:border-slate-600 rounded-lg outline-none focus:ring-1 focus:ring-rose-500 font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800" />
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredAssets.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="p-20 text-center">
                                                <div className="flex flex-col items-center opacity-20">
                                                    <Landmark size={40} />
                                                    <p className="text-xs font-black uppercase mt-4 tracking-widest">Không tìm thấy tài sản</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AssetAudit;
