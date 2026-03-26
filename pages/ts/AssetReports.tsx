import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useToast } from '../../context/ToastContext';
import {
    FileText, Download, Calendar, Search, Filter,
    Landmark, PieChart, Printer, TrendingUp, Shield,
    BarChart3
} from 'lucide-react';
import { AssetStatus, ASSET_STATUS_LABELS } from '../../types';
import * as XLSX from 'xlsx';

const AssetReports: React.FC = () => {
    const { assets, assetCategories, assetAssignments } = useApp();
  useModuleData('ts');
    const toast = useToast();

    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedCategory, setSelectedCategory] = useState('ALL');
    const [selectedStatus, setSelectedStatus] = useState('ALL');
    const [searchTerm, setSearchTerm] = useState('');

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || 'Khác';

    const reportData = useMemo(() => {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        const now = new Date();

        return assets
            .filter(a => {
                const purchaseDate = new Date(a.purchaseDate);
                const matchesDate = purchaseDate >= start && purchaseDate <= end;
                const matchesCategory = selectedCategory === 'ALL' || a.categoryId === selectedCategory;
                const matchesStatus = selectedStatus === 'ALL' || a.status === selectedStatus;
                const matchesSearch = a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    a.code.toLowerCase().includes(searchTerm.toLowerCase());
                return matchesDate && matchesCategory && matchesStatus && matchesSearch;
            })
            .map(a => {
                const purchaseDate = new Date(a.purchaseDate);
                const monthsUsed = Math.max(0,
                    (now.getFullYear() - purchaseDate.getFullYear()) * 12 +
                    (now.getMonth() - purchaseDate.getMonth()));
                const totalMonths = a.depreciationYears * 12;
                const depreciable = a.originalValue - a.residualValue;
                const monthlyDep = totalMonths > 0 ? depreciable / totalMonths : 0;
                const accumulatedDep = Math.min(depreciable, monthlyDep * monthsUsed);
                const remainingValue = a.originalValue - accumulatedDep;
                const depPercent = a.originalValue > 0 ? (accumulatedDep / a.originalValue) * 100 : 0;

                // Warranty info
                let warrantyDaysLeft = 0;
                let warrantyExpiry: Date | null = null;
                if (a.warrantyMonths && a.warrantyMonths > 0) {
                    warrantyExpiry = new Date(a.purchaseDate);
                    warrantyExpiry.setMonth(warrantyExpiry.getMonth() + a.warrantyMonths);
                    warrantyDaysLeft = Math.ceil((warrantyExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                }

                return {
                    id: a.id,
                    code: a.code,
                    name: a.name,
                    category: getCategoryName(a.categoryId),
                    status: a.status,
                    purchaseDate: a.purchaseDate,
                    originalValue: a.originalValue,
                    depreciationYears: a.depreciationYears,
                    residualValue: a.residualValue,
                    monthlyDep,
                    accumulatedDep,
                    remainingValue,
                    depPercent,
                    warrantyMonths: a.warrantyMonths || 0,
                    warrantyDaysLeft,
                    warrantyExpiry,
                    assignedTo: a.assignedToName || '-',
                };
            });
    }, [assets, assetCategories, startDate, endDate, selectedCategory, selectedStatus, searchTerm]);

    const summary = useMemo(() => {
        return reportData.reduce((acc, row) => ({
            totalOriginal: acc.totalOriginal + row.originalValue,
            totalDepreciated: acc.totalDepreciated + row.accumulatedDep,
            totalRemaining: acc.totalRemaining + row.remainingValue,
            count: acc.count + 1,
            warrantyExpiring: acc.warrantyExpiring + (row.warrantyDaysLeft > 0 && row.warrantyDaysLeft <= 30 ? 1 : 0)
        }), { totalOriginal: 0, totalDepreciated: 0, totalRemaining: 0, count: 0, warrantyExpiring: 0 });
    }, [reportData]);

    const handleExportExcel = () => {
        const data = reportData.map((r, idx) => ({
            'STT': idx + 1,
            'Mã TS': r.code,
            'Tên tài sản': r.name,
            'Phân loại': r.category,
            'Trạng thái': ASSET_STATUS_LABELS[r.status],
            'Ngày mua': new Date(r.purchaseDate).toLocaleDateString('vi-VN'),
            'Nguyên giá (đ)': r.originalValue,
            'KH (năm)': r.depreciationYears,
            'KH/tháng (đ)': Math.round(r.monthlyDep),
            'KH lũy kế (đ)': Math.round(r.accumulatedDep),
            'Giá trị còn lại (đ)': Math.round(r.remainingValue),
            'GTCL %': `${(100 - r.depPercent).toFixed(1)}%`,
            'BH (tháng)': r.warrantyMonths,
            'BH còn lại (ngày)': r.warrantyDaysLeft > 0 ? r.warrantyDaysLeft : 'Hết',
            'Người sử dụng': r.assignedTo
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        ws['!cols'] = [
            { wch: 5 }, { wch: 12 }, { wch: 28 }, { wch: 15 }, { wch: 14 }, { wch: 12 },
            { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 8 },
            { wch: 10 }, { wch: 14 }, { wch: 18 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo TS');
        const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `BaoCao_TaiSan_${startDate}_to_${endDate}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success('Xuất Excel', 'Đã tải file báo cáo tài sản.');
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <BarChart3 className="text-rose-500" size={24} /> Báo cáo tài sản
                    </h1>
                    <p className="text-sm text-slate-500 font-medium">Thống kê chi tiết nguyên giá, khấu hao và bảo hành tài sản.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => window.print()}
                        className="flex items-center px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition shadow-lg shadow-slate-900/20 font-bold text-sm">
                        <Printer size={18} className="mr-2" /> In PDF
                    </button>
                    <button onClick={handleExportExcel}
                        className="flex items-center px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition shadow-lg shadow-emerald-500/20 font-bold text-sm">
                        <Download size={18} className="mr-2" /> Xuất Excel
                    </button>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-wrap gap-4 items-end">
                <div className="space-y-1.5 flex-1 min-w-[200px]">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                        <Calendar size={12} className="mr-1" /> Khoảng thời gian mua
                    </label>
                    <div className="flex items-center gap-2">
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="flex-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500" />
                        <span className="text-slate-400 font-bold">→</span>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                            className="flex-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500" />
                    </div>
                </div>

                <div className="space-y-1.5 w-full md:w-48">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                        <Filter size={12} className="mr-1" /> Phân loại
                    </label>
                    <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                        className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500">
                        <option value="ALL">Tất cả loại</option>
                        {assetCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>

                <div className="space-y-1.5 w-full md:w-48">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                        <Filter size={12} className="mr-1" /> Trạng thái
                    </label>
                    <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)}
                        className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500">
                        <option value="ALL">Tất cả</option>
                        {Object.entries(ASSET_STATUS_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                </div>

                <div className="space-y-1.5 flex-1 min-w-[200px]">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                        <Search size={12} className="mr-1" /> Tìm tài sản
                    </label>
                    <input type="text" placeholder="Tên hoặc mã TS..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-rose-500" />
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100 dark:border-indigo-800">
                        <Landmark size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">{summary.count} tài sản</p>
                        <p className="text-lg font-black text-slate-800 dark:text-white">{summary.totalOriginal.toLocaleString('vi-VN')} ₫</p>
                        <p className="text-[9px] text-slate-400 font-bold">Tổng nguyên giá</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 text-rose-600 rounded-xl flex items-center justify-center border border-rose-100 dark:border-rose-800">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">Đã khấu hao</p>
                        <p className="text-lg font-black text-rose-600">{Math.round(summary.totalDepreciated).toLocaleString('vi-VN')} ₫</p>
                        <p className="text-[9px] text-slate-400 font-bold">{summary.totalOriginal > 0 ? ((summary.totalDepreciated / summary.totalOriginal) * 100).toFixed(1) : 0}% nguyên giá</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100 dark:border-emerald-800">
                        <PieChart size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">Giá trị còn lại</p>
                        <p className="text-lg font-black text-emerald-600">{Math.round(summary.totalRemaining).toLocaleString('vi-VN')} ₫</p>
                        <p className="text-[9px] text-slate-400 font-bold">{summary.totalOriginal > 0 ? ((summary.totalRemaining / summary.totalOriginal) * 100).toFixed(1) : 0}% nguyên giá</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${summary.warrantyExpiring > 0 ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 border-amber-100 dark:border-amber-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                        <Shield size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">BH sắp hết</p>
                        <p className={`text-lg font-black ${summary.warrantyExpiring > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{summary.warrantyExpiring}</p>
                        <p className="text-[9px] text-slate-400 font-bold">trong 30 ngày tới</p>
                    </div>
                </div>
            </div>

            {/* Report Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                <div className="overflow-x-auto scrollbar-hide">
                    <table className="w-full text-left border-collapse min-w-[1400px]">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                                <th className="p-4 sticky left-0 bg-slate-50 dark:bg-slate-800/50 z-10 border-r border-slate-100 dark:border-slate-700">Tài sản / Mã</th>
                                <th className="p-4">Loại</th>
                                <th className="p-4 text-center">Trạng thái</th>
                                <th className="p-4 text-center">Ngày mua</th>
                                <th className="p-4 text-right bg-indigo-50/30 dark:bg-indigo-950/10">Nguyên giá</th>
                                <th className="p-4 text-center">KH (năm)</th>
                                <th className="p-4 text-right">KH/tháng</th>
                                <th className="p-4 text-right bg-rose-50/30 dark:bg-rose-950/10 font-bold text-rose-600">KH lũy kế</th>
                                <th className="p-4 text-right bg-emerald-50/30 dark:bg-emerald-950/10 font-bold text-emerald-600">Còn lại</th>
                                <th className="p-4 text-center">BH còn</th>
                                <th className="p-4">Người dùng</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                            {reportData.map(row => (
                                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                                    <td className="p-4 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/30 z-10 border-r border-slate-100 dark:border-slate-700">
                                        <div className="font-bold text-slate-800 dark:text-white">{row.name}</div>
                                        <div className="text-[10px] font-mono text-slate-400">{row.code}</div>
                                    </td>
                                    <td className="p-4 text-xs font-bold text-slate-500">{row.category}</td>
                                    <td className="p-4 text-center">
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                            row.status === AssetStatus.AVAILABLE ? 'bg-emerald-50 text-emerald-600' :
                                            row.status === AssetStatus.IN_USE ? 'bg-blue-50 text-blue-600' :
                                            row.status === AssetStatus.MAINTENANCE ? 'bg-amber-50 text-amber-600' :
                                            row.status === AssetStatus.DISPOSED ? 'bg-slate-100 text-slate-500' :
                                            'bg-red-50 text-red-600'
                                        }`}>
                                            {ASSET_STATUS_LABELS[row.status]}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center text-xs text-slate-500 font-bold">{new Date(row.purchaseDate).toLocaleDateString('vi-VN')}</td>
                                    <td className="p-4 text-right font-bold text-slate-700 dark:text-slate-300 bg-indigo-50/10 dark:bg-indigo-950/5">
                                        {row.originalValue.toLocaleString('vi-VN')}
                                    </td>
                                    <td className="p-4 text-center text-slate-500 font-bold">{row.depreciationYears}</td>
                                    <td className="p-4 text-right text-slate-500">{Math.round(row.monthlyDep).toLocaleString('vi-VN')}</td>
                                    <td className="p-4 text-right font-black text-rose-600 bg-rose-50/10 dark:bg-rose-950/5">
                                        {Math.round(row.accumulatedDep).toLocaleString('vi-VN')}
                                        <div className="text-[9px] text-slate-400 font-bold">{row.depPercent.toFixed(1)}%</div>
                                    </td>
                                    <td className="p-4 text-right font-black text-emerald-600 bg-emerald-50/10 dark:bg-emerald-950/5">
                                        {Math.round(row.remainingValue).toLocaleString('vi-VN')}
                                    </td>
                                    <td className="p-4 text-center">
                                        {row.warrantyMonths > 0 ? (
                                            <div>
                                                <span className={`text-[10px] font-black ${row.warrantyDaysLeft <= 0 ? 'text-slate-400' : row.warrantyDaysLeft <= 30 ? 'text-red-500' : 'text-emerald-500'}`}>
                                                    {row.warrantyDaysLeft <= 0 ? 'Hết' : `${row.warrantyDaysLeft}d`}
                                                </span>
                                                {row.warrantyExpiry && (
                                                    <div className="text-[9px] text-slate-400">{row.warrantyExpiry.toLocaleDateString('vi-VN')}</div>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-slate-200">-</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-xs text-slate-500 font-medium">{row.assignedTo}</td>
                                </tr>
                            ))}
                            {reportData.length === 0 && (
                                <tr>
                                    <td colSpan={11} className="p-20 text-center">
                                        <div className="flex flex-col items-center opacity-30">
                                            <Landmark size={48} />
                                            <p className="mt-4 font-bold">Không có dữ liệu cho bộ lọc này</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {reportData.length > 0 && (
                            <tfoot>
                                <tr className="bg-slate-800 dark:bg-slate-950 text-white font-black text-sm border-t-2 border-slate-200 dark:border-slate-600">
                                    <td colSpan={4} className="p-4 sticky left-0 bg-slate-800 dark:bg-slate-950 z-10">
                                        TỔNG CỘNG ({summary.count} tài sản)
                                    </td>
                                    <td className="p-4 text-right">{summary.totalOriginal.toLocaleString('vi-VN')} ₫</td>
                                    <td className="p-4"></td>
                                    <td className="p-4"></td>
                                    <td className="p-4 text-right text-rose-300">{Math.round(summary.totalDepreciated).toLocaleString('vi-VN')} ₫</td>
                                    <td className="p-4 text-right text-emerald-300">{Math.round(summary.totalRemaining).toLocaleString('vi-VN')} ₫</td>
                                    <td className="p-4"></td>
                                    <td className="p-4"></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AssetReports;
